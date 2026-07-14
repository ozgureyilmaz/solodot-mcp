import type { WorkflowKey } from "../harness/types";

export type OrchestrationMode = "advisor" | "orchestrator";
export type HarnessWorkstream = { key: string; title: string; dependsOn?: string[] };
export type HarnessRoutingDecision = {
  mode: OrchestrationMode;
  workstreams: HarnessWorkstream[];
  workerCount: number;
  confidence: number;
  reason: string;
};

const workstreams: Record<WorkflowKey, HarnessWorkstream[]> = {
  bottleneck_map: [
    { key: "constraint-map", title: "Rank constraints and select the next move" },
  ],
  first_customer_pipeline: [
    { key: "buyer", title: "Define the buyer and trigger hypothesis" },
    { key: "channel", title: "Choose and bound the acquisition channel" },
    { key: "offer", title: "Draft the offer angle and outreach asset" },
  ],
  founder_function_map: [
    { key: "function-map", title: "Map founder work" },
    { key: "weekly-rhythm", title: "Build the weekly rhythm", dependsOn: ["function-map"] },
  ],
  customer_learning_loop: [
    { key: "feedback", title: "Synthesize feedback" },
    { key: "experiment", title: "Choose the next experiment", dependsOn: ["feedback"] },
  ],
  trust_packet: [
    { key: "proof-audit", title: "Audit proof gaps and unsupported claims" },
    { key: "buyer-response", title: "Draft the buyer-facing response" },
  ],
  agent_workflow_plan: [
    { key: "role-design", title: "Design agent roles and handoffs" },
    { key: "approval-audit", title: "Audit approval and review gates" },
  ],
};

export function routeExecutionPack(
  workflowKey: WorkflowKey,
  maxWorkers = 8,
): HarnessRoutingDecision {
  const streams = workstreams[workflowKey];
  const independent = streams.filter((stream) => !stream.dependsOn?.length);
  if (independent.length < 2) {
    return {
      mode: "advisor",
      workstreams: streams,
      workerCount: 1,
      confidence: streams.length === 1 ? 0.94 : 0.82,
      reason:
        streams.length === 1
          ? "One useful workstream is most efficient with a main executor and focused advisor gates."
          : "The workstreams are sequential, so parallel workers would add coordination cost without useful independence.",
    };
  }
  return {
    mode: "orchestrator",
    workstreams: streams,
    workerCount: Math.min(independent.length, Math.max(1, Math.floor(maxWorkers))),
    confidence: 0.9,
    reason: `${independent.length} independent workstreams can run in parallel before one synthesis pass.`,
  };
}
