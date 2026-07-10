import { randomUUID } from "node:crypto";
import { callStructuredProvider } from "./providers";
import { getProviderConfig } from "./runDiagnostic";
import {
  executionArtifactTypes,
  workflowKeys,
  type DiagnosticResult,
  type ExecutionArtifactType,
  type ExecutionAsset,
  type JsonSchema,
  type WorkflowKey,
} from "./types";

const MAX_CONTENT = 8000;
const MAX_ITEM = 1200;

const executionAssetSchema = {
  type: "object",
  required: [
    "artifactType",
    "title",
    "content",
    "assumptions",
    "risks",
    "unsupportedClaims",
    "nextSteps",
    "evaluation",
    "approvalPrompt",
  ],
  properties: {
    artifactType: { type: "string", enum: executionArtifactTypes },
    title: { type: "string" },
    content: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
    evaluation: {
      type: "object",
      required: ["score", "recommendation"],
      properties: {
        score: { type: "number", minimum: 0, maximum: 100 },
        recommendation: {
          type: "string",
          enum: ["approve", "revise", "reject"],
        },
      },
    },
    approvalPrompt: { type: "string" },
  },
} satisfies JsonSchema;

const packInstructions: Record<WorkflowKey, string> = {
  bottleneck_map:
    "Produce ranked constraints, the selected constraint, one next move, and a not-this-week list.",
  first_customer_pipeline:
    "Produce an ICP hypothesis, buyer trigger, channel choice, offer angle, and a seven-day customer-finding sprint.",
  founder_function_map:
    "Separate founder-only, agent-assisted, paused, and batched work, then create a realistic weekly rhythm.",
  customer_learning_loop:
    "Synthesize feedback, state the retention or drop-off hypothesis, draft learning questions, and choose the next experiment.",
  trust_packet:
    "Draft the buyer-facing response, identify proof gaps, and explicitly flag every unsupported security, compliance, support, and continuity claim.",
  agent_workflow_plan:
    "Define roles, required inputs, handoff artifacts, approval gates, one final execution asset, and a review checklist.",
};

export async function runExecutionHarness({
  diagnostic,
  corrections = "",
}: {
  diagnostic: DiagnosticResult;
  corrections?: string;
}): Promise<ExecutionAsset> {
  const providerConfig = getProviderConfig(diagnostic.provider);
  const { system, user } = buildExecutionPrompt(diagnostic, corrections);
  const raw = await callStructuredProvider(
    {
      provider: diagnostic.provider,
      ...providerConfig,
      system,
      user,
      schema: executionAssetSchema,
    },
    "execution_asset",
    "Emit one founder-reviewable Solodot execution asset.",
  );

  return normalizeExecutionAsset({
    raw,
    runId: diagnostic.runId,
    workflowKey: diagnostic.agentHandoff.workflowKey,
  });
}

export function buildExecutionPrompt(
  diagnostic: DiagnosticResult,
  corrections = "",
) {
  const workflowKey = diagnostic.agentHandoff.workflowKey;
  const system = `You are Solodot's pack-specific Execution Harness.

Solodot identifies a solo-founder's active painpoint, routes it to one execution pack, and prepares one founder-approved execution asset. The route is already fixed to ${workflowKey}; do not change it.

Pack requirement: ${packInstructions[workflowKey]}

Rules:
- Produce a concrete asset the founder can review and use manually this week.
- Use compact Markdown headings and lists in content; do not use fenced code blocks or HTML.
- Keep content under ${MAX_CONTENT} characters.
- Return 1 to 5 assumptions, risks, unsupported claims, and next steps.
- Never invent customers, revenue, testimonials, research, security posture, compliance posture, integrations, or completed work.
- Never claim that email was sent, Slack was posted to, a CRM was updated, content was published, an invoice was changed, or any external action occurred.
- Stop at draft, preview, plan, queue, or export-ready content.
- Founder approval is mandatory before the asset is treated as accepted.
- Trust Packet must flag unsupported security, compliance, support, continuity, and proof claims.
- Set artifactType to the routed workflow key.
- Return only the structured object requested by the schema.`;

  const user = `Routed Solodot run:
Primary bottleneck: ${diagnostic.diagnosis.primaryBottleneck}
Secondary bottleneck: ${diagnostic.diagnosis.secondaryBottleneck}
Routing reason: ${diagnostic.diagnosis.reasoning}
Selected pack: ${diagnostic.recommendedPack.name}
Existing preview: ${diagnostic.recommendedPack.executionAsset}
Context brief: ${diagnostic.agentHandoff.contextBrief}
Assumptions: ${diagnostic.assumptions.join(" | ")}
Risks: ${diagnostic.risks.join(" | ")}
Missing context: ${diagnostic.missingContext.join(" | ")}
Founder corrections or constraints: ${corrections.trim() || "None provided"}

Create the full execution asset for the fixed workflow.`;

  return { system, user };
}

export function normalizeExecutionAsset({
  raw,
  runId,
  workflowKey,
  createdAt = new Date().toISOString(),
}: {
  raw: unknown;
  runId: string;
  workflowKey: WorkflowKey;
  createdAt?: string;
}): ExecutionAsset {
  const body = asRecord(raw);
  const evaluation = asRecord(body.evaluation);
  const artifactType = normalizeArtifactType(body.artifactType, workflowKey);
  const content = cleanText(body.content, MAX_CONTENT);

  if (!content) {
    throw new Error("Execution provider returned an empty asset.");
  }

  return {
    assetId: `asset_${randomUUID()}`,
    runId,
    workflowKey,
    artifactType,
    title: cleanText(body.title, 240) || "Founder-reviewable execution asset",
    content: enforcePreviewOnly(content),
    assumptions: cleanList(body.assumptions, [
      "The founder will confirm the context before using this asset.",
    ]),
    risks: cleanList(body.risks, [
      "The asset may need revision when missing context is supplied.",
    ]),
    unsupportedClaims: cleanList(body.unsupportedClaims, []),
    nextSteps: cleanList(body.nextSteps, [
      "Review the asset and approve, revise, or reject it.",
    ]),
    evaluation: {
      score: clampScore(evaluation.score),
      recommendation: normalizeRecommendation(evaluation.recommendation),
    },
    status: "proposed",
    approvalPrompt:
      cleanText(body.approvalPrompt, 500) ||
      "Approve, revise, or reject this asset before using it.",
    createdAt,
  };
}

function enforcePreviewOnly(content: string) {
  const completedExternalAction =
    /\b(sent|emailed|posted to slack|published|updated (?:the )?crm|created (?:the )?invoice|charged|executed externally)\b/i;
  if (completedExternalAction.test(content)) {
    throw new Error(
      "Execution asset implied an external action had already occurred.",
    );
  }
  return content;
}

function normalizeArtifactType(
  value: unknown,
  workflowKey: WorkflowKey,
): ExecutionArtifactType {
  if (
    typeof value === "string" &&
    executionArtifactTypes.includes(value as ExecutionArtifactType) &&
    value === workflowKey
  ) {
    return value as ExecutionArtifactType;
  }
  return workflowKey;
}

function normalizeRecommendation(value: unknown) {
  if (value === "approve" || value === "reject") return value;
  return "revise" as const;
}

function clampScore(value: unknown) {
  const score = typeof value === "number" ? value : Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
}

function cleanList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item) => cleanText(item, MAX_ITEM))
    .filter(Boolean)
    .slice(0, 5);
  return items.length > 0 ? items : fallback;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isWorkflowKey(value: unknown): value is WorkflowKey {
  return (
    typeof value === "string" && workflowKeys.includes(value as WorkflowKey)
  );
}
