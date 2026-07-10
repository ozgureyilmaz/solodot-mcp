import type {
  DiagnosticIntake,
  DiagnosticResult,
  ExecutionAsset,
  WorkflowKey,
} from "../src/harness/types";

export const intake: DiagnosticIntake = {
  provider: "anthropic",
  founderType: "Solo SaaS founder",
  stage: "Prototype before first hire",
  offer: "A focused workflow product",
  customerContext: "Three interviews and no paid customers",
  bottleneck: "Too many possible next moves",
  recentAttempt: "Published a generic launch post",
  weeklyConstraint: "Ten founder hours",
  trustBlocker: "",
  validationEvidence: "Three interviews",
  criticalAssumption: "One buyer will accept a paid pilot",
};

export function diagnostic(
  workflowKey: WorkflowKey = "first_customer_pipeline",
): DiagnosticResult {
  return {
    runId: "diag_test_001",
    provider: "anthropic",
    harnessVersion: "diagnostic-harness-v0.2",
    createdAt: "2026-07-10T12:00:00.000Z",
    storage: { status: "not_configured" },
    diagnosis: {
      primaryBottleneck: "No repeatable customer-finding motion",
      secondaryBottleneck: "Offer evidence is thin",
      reasoning: "The product exists, but demand has not been tested with a focused weekly motion.",
    },
    recommendedPack: {
      name: workflowKey === "first_customer_pipeline" ? "First-Customer Pipeline" : "Bottleneck Map",
      why: "The route follows the strongest evidence.",
      executionAsset: "Run a focused seven-day validation sprint.",
    },
    notThisWeek: ["Do not add more product scope."],
    assumptions: ["The interviews represent the target buyer."],
    risks: ["The offer may still be too broad."],
    missingContext: ["Paid-pilot price is unknown."],
    recommendedActions: [],
    evaluation: { score: 82, recommendation: "approve" },
    approvalGate: { prompt: "Approve, revise, or reject the route." },
    agentHandoff: {
      workflowKey,
      contextBrief: "A solo founder needs a measurable customer-finding sprint.",
      nextAgentRoles: ["Planner", "Generator"],
      approvalRequiredFor: ["Any customer-facing message"],
      suggestedNextRun: "Generate the selected execution asset.",
    },
  };
}

export function asset(
  workflowKey: WorkflowKey = "first_customer_pipeline",
): ExecutionAsset {
  return {
    assetId: "asset_test_001",
    runId: "diag_test_001",
    workflowKey,
    artifactType: workflowKey,
    title: "Seven-day customer validation sprint",
    content: "# Sprint\n\nInterview five target buyers and ask for one paid pilot.",
    assumptions: ["The target buyer can be reached this week."],
    risks: ["The sample may be too small."],
    unsupportedClaims: [],
    nextSteps: ["Review the target list."],
    evaluation: { score: 88, recommendation: "approve" },
    status: "proposed",
    approvalPrompt: "Approve, revise, or reject this sprint.",
    createdAt: "2026-07-10T12:01:00.000Z",
  };
}
