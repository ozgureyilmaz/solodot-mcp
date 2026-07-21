import {
  buildExecutionPrompt,
  executionAssetSchema,
  isWorkflowKey,
  normalizeExecutionAsset,
} from "../harness/execution";
import type {
  DiagnosticResult,
  ExecutionAsset,
  JsonSchema,
} from "../harness/types";
import { RuntimeOpenAIGateway } from "./gateway";
import { routeExecutionPack } from "./routing";

const reviewSchema = {
  type: "object",
  required: ["safe", "concerns"],
  properties: {
    safe: { type: "boolean" },
    concerns: { type: "array", items: { type: "string" } },
  },
} satisfies JsonSchema;

const planSchema = {
  type: "object",
  required: ["workstreams", "synthesisRule"],
  properties: {
    workstreams: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "instruction"],
        properties: {
          key: { type: "string" },
          instruction: { type: "string" },
        },
      },
    },
    synthesisRule: { type: "string" },
  },
} satisfies JsonSchema;

const workerSchema = {
  type: "object",
  required: ["title", "content", "assumptions", "risks"],
  properties: {
    title: { type: "string" },
    content: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
  },
} satisfies JsonSchema;

export async function runAdaptiveExecution({
  diagnostic,
  workflowKey,
  gateway,
  maxWorkers,
}: {
  diagnostic: DiagnosticResult;
  workflowKey: string;
  gateway: RuntimeOpenAIGateway;
  maxWorkers: number;
}): Promise<{ asset: ExecutionAsset; review?: unknown; routing: unknown }> {
  if (!isWorkflowKey(workflowKey)) throw new Error("Runtime job has an invalid workflow key.");
  const routing = routeExecutionPack(workflowKey, maxWorkers);
  if (routing.mode === "advisor") {
    const { system, user } = buildExecutionPrompt(diagnostic);
    const raw = await gateway.call({
      role: "worker",
      system,
      user,
      schema: executionAssetSchema,
      outputName: "execution_asset",
      outputDescription: "Emit one founder-reviewable Solodot execution asset.",
    });
    const asset = normalizeExecutionAsset({ raw, runId: diagnostic.runId, workflowKey });
    const needsGate = workflowKey === "trust_packet" || workflowKey === "agent_workflow_plan";
    const review = needsGate
      ? await gateway.call({
          role: "reviewer",
          system: "You are a read-only Solodot safety and unsupported-claims advisor. Do not rewrite the asset.",
          user: JSON.stringify(asset),
          schema: reviewSchema,
          outputName: "advisor_review",
          outputDescription: "Report whether the asset preserves founder approval and avoids unsupported claims.",
        })
      : undefined;
    return { asset, review, routing };
  }

  const plan = (await gateway.call({
    role: "planner",
    system: "You are the Solodot orchestration planner. Keep workstreams isolated, bounded, and synthesis-ready.",
    user: JSON.stringify({ diagnostic, proposedWorkstreams: routing.workstreams }),
    schema: planSchema,
    outputName: "orchestration_plan",
    outputDescription: "Refine the independent workstream instructions and one synthesis rule.",
  })) as { workstreams?: Array<{ key?: string; instruction?: string }>; synthesisRule?: string };

  const workerOutputs = await mapInWaves(
    routing.workstreams,
    routing.workerCount,
    async (workstream) => {
      const planned = plan.workstreams?.find((item) => item.key === workstream.key);
      return gateway.call({
        role: "worker",
        system:
          "You are one isolated Solodot worker. Complete only the assigned workstream. Do not perform external actions and do not assume another worker's unpublished output.",
        user: JSON.stringify({
          diagnostic,
          workstream,
          instruction: planned?.instruction || workstream.title,
        }),
        schema: workerSchema,
        outputName: "workstream_result",
        outputDescription: "Return one bounded workstream contribution for synthesis.",
      });
    },
  );

  const { system, user } = buildExecutionPrompt(diagnostic);
  const raw = await gateway.call({
    role: "synthesizer",
    system: `${system}\n\nSynthesize isolated worker contributions into one coherent asset. Preserve uncertainty and founder approval.`,
    user: `${user}\n\nSynthesis rule: ${plan.synthesisRule || "Use only supported worker findings."}\nWorker contributions:\n${JSON.stringify(workerOutputs)}`,
    schema: executionAssetSchema,
    outputName: "execution_asset",
    outputDescription: "Synthesize one founder-reviewable Solodot execution asset.",
  });
  return {
    asset: normalizeExecutionAsset({ raw, runId: diagnostic.runId, workflowKey }),
    routing,
  };
}

async function mapInWaves<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const output: R[] = [];
  const size = Math.max(1, concurrency);
  for (let index = 0; index < values.length; index += size) {
    output.push(...(await Promise.all(values.slice(index, index + size).map(mapper))));
  }
  return output;
}
