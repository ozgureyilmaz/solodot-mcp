import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runExecutionHarness } from "./harness/execution";
import {
  type ExecutionRepository,
  type SolodotRunRecord,
} from "./harness/executionRepository";
import { runDiagnosticHarness } from "./harness/runDiagnostic";
import {
  packNames,
  type DiagnosticIntake,
  type DiagnosticResult,
  type ExecutionAsset,
} from "./harness/types";
import { parseDiagnosticIntake } from "./harness/validation";

const text = z.string().trim().min(2).max(1800);
const optionalText = z.string().trim().max(1800).optional().default("");
const runId = z.string().trim().min(3).max(180);
const assetId = z.string().trim().min(3).max(180);

const routeInput = z.object({
  founderType: text,
  stage: text,
  offer: text,
  customerContext: optionalText,
  bottleneck: text,
  recentAttempt: text,
  weeklyConstraint: text,
  trustBlocker: optionalText,
  validationEvidence: optionalText,
  criticalAssumption: optionalText,
});

export type SolodotServerDependencies = {
  repository: ExecutionRepository;
  principal: string;
  route?: (intake: DiagnosticIntake) => Promise<DiagnosticResult>;
  execute?: (input: {
    diagnostic: DiagnosticResult;
    corrections?: string;
  }) => Promise<ExecutionAsset>;
};

export function createSolodotMcpServer({
  repository,
  principal,
  route = runDiagnosticHarness,
  execute = runExecutionHarness,
}: SolodotServerDependencies) {
  const server = new McpServer(
    { name: "solodot", version: "0.1.0" },
    {
      instructions:
        "Solodot routes a solo-founder's active painpoint to one execution pack and prepares one founder-reviewable asset. Call route_painpoint before generate_execution_asset. Founder approval is always required. Solodot never sends email, posts to Slack, updates a CRM, publishes, invoices, or performs another external action. Use review_execution_asset to approve, request revision, or reject; approval records acceptance only.",
    },
  );

  server.registerTool(
    "route_painpoint",
    {
      title: "Route a founder painpoint",
      description:
        "Diagnose the active solo-founder painpoint, select exactly one Solodot execution pack, and return a lightweight action preview. This does not perform external actions.",
      inputSchema: routeInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      const intake = parseDiagnosticIntake(input);
      const diagnostic = await route(intake);
      await repository.saveDiagnostic(principal, intake, diagnostic);
      const safeDiagnostic = sanitizeDiagnostic(diagnostic, repository.durable);
      return toolResult(
        `Routed to ${diagnostic.recommendedPack.name}. Review the diagnosis before generating the execution asset.`,
        safeDiagnostic,
      );
    },
  );

  server.registerTool(
    "generate_execution_asset",
    {
      title: "Generate the routed execution asset",
      description:
        "Generate one concrete, preview-only execution asset for the pack already selected by route_painpoint. The routed pack cannot be changed by this tool.",
      inputSchema: z.object({
        runId,
        corrections: z.string().trim().max(4000).optional().default(""),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ runId: id, corrections }) => {
      const record = await repository.getRun(principal, id);
      const asset = await execute({
        diagnostic: record.diagnostic,
        corrections,
      });
      await repository.saveAsset(principal, asset);
      return toolResult(
        `Generated ${asset.title}. Founder approval is still required; no external action occurred.`,
        asset,
      );
    },
  );

  server.registerTool(
    "review_execution_asset",
    {
      title: "Review an execution asset",
      description:
        "Record approve, revise, or reject for a generated Solodot asset. Approval records acceptance only and never executes the asset externally.",
      inputSchema: z.object({
        runId,
        assetId,
        decision: z.enum(["approve", "revise", "reject"]),
        reason: z.string().trim().max(1800).optional().default(""),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ runId: id, assetId: targetAssetId, decision, reason }) => {
      const asset = await repository.reviewAsset(
        principal,
        id,
        targetAssetId,
        decision,
        reason,
      );
      const nextInstruction =
        decision === "revise"
          ? "Call generate_execution_asset again with founder corrections."
          : decision === "approve"
            ? "The asset can now be exported manually. No external action occurred."
            : "The asset remains rejected and cannot be exported.";
      return toolResult(
        `Recorded ${decision} for ${asset.title}. ${nextInstruction}`,
        { asset, nextInstruction },
      );
    },
  );

  server.registerTool(
    "get_solodot_run",
    {
      title: "Inspect a Solodot run",
      description:
        "Return the authenticated founder's diagnosis, generated assets, approval history, and latest recommended step.",
      inputSchema: z.object({ runId }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ runId: id }) => {
      const record = await repository.getRun(principal, id);
      const output = runView(record);
      return toolResult(
        `Loaded Solodot run ${id}. ${output.latestRecommendedStep}`,
        output,
      );
    },
  );

  server.registerTool(
    "export_solodot_run",
    {
      title: "Export an approved Solodot run",
      description:
        "Return an approved execution asset as Markdown or JSON. The tool returns content only; it does not write files, post messages, or publish.",
      inputSchema: z.object({
        runId,
        format: z.enum(["markdown", "json"]),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ runId: id, format }) => {
      const record = await repository.getRun(principal, id);
      const approved = [...record.assets]
        .reverse()
        .find((candidate) => candidate.status === "approved");
      if (!approved) {
        throw new Error("An approved execution asset is required before export.");
      }
      const content =
        format === "json"
          ? JSON.stringify({ runId: id, diagnostic: record.diagnostic, asset: approved }, null, 2)
          : markdownExport(record, approved);
      return toolResult(
        `Prepared the approved ${format} export. Nothing was written or posted externally.`,
        { runId: id, assetId: approved.assetId, format, content },
      );
    },
  );

  registerResources(server);
  return server;
}

function registerResources(server: McpServer) {
  server.registerResource(
    "execution-packs",
    "solodot://execution-packs",
    {
      title: "Solodot execution packs",
      description: "The six workflows available to the painpoint router.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(packNames, null, 2) }],
    }),
  );
  server.registerResource(
    "approval-boundaries",
    "solodot://approval-boundaries",
    {
      title: "Solodot approval boundaries",
      description: "Actions that Solodot must never perform silently.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: "# Approval boundaries\n\nFounder approval is mandatory. Solodot does not send email, post to Slack, update a CRM, publish, invoice, make compliance claims, or perform irreversible external actions.",
        },
      ],
    }),
  );
  server.registerResource(
    "product-context",
    "solodot://product-context",
    {
      title: "Solodot product context",
      description: "The product promise and role of the intake/router.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: "# Solodot\n\nIdentify the active solo-founder painpoint, route it to the right agent harness, and produce one founder-approved action or execution asset. The diagnostic is the intake/router, not the product identity.",
        },
      ],
    }),
  );
}

function sanitizeDiagnostic(diagnostic: DiagnosticResult, durable: boolean) {
  return {
    ...diagnostic,
    storage: {
      status: durable ? "stored" : "not_configured",
      message: durable
        ? "Stored for the authenticated MCP principal."
        : "Stored in memory for this local MCP process.",
    },
  };
}

function runView(record: SolodotRunRecord) {
  const latest = record.assets.at(-1);
  return {
    runId: record.diagnostic.runId,
    diagnosis: record.diagnostic.diagnosis,
    recommendedPack: record.diagnostic.recommendedPack,
    assumptions: record.diagnostic.assumptions,
    risks: record.diagnostic.risks,
    missingContext: record.diagnostic.missingContext,
    assets: record.assets,
    approvals: record.approvals,
    latestRecommendedStep: latest
      ? latest.status === "approved"
        ? "Export the approved asset manually."
        : latest.status === "revision_requested"
          ? "Generate a revised asset with the founder's corrections."
          : latest.status === "rejected"
            ? "Clarify the founder context before generating another asset."
            : "Review the proposed asset."
      : "Generate the routed execution asset.",
  };
}

function markdownExport(record: SolodotRunRecord, asset: ExecutionAsset) {
  return `# ${asset.title}\n\nRun: ${record.diagnostic.runId}\nWorkflow: ${asset.workflowKey}\nStatus: approved\n\n${asset.content}\n\n## Assumptions\n${list(asset.assumptions)}\n\n## Risks\n${list(asset.risks)}\n\n## Unsupported claims\n${list(asset.unsupportedClaims)}\n\n## Next steps\n${list(asset.nextSteps)}\n\n> Founder-approved execution asset. No external action was performed by Solodot.`;
}

function list(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None recorded";
}

function toolResult(summary: string, data: unknown) {
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent: JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
  };
}
