export const HARNESS_VERSION = "diagnostic-harness-v0.2";

export const providerOptions = ["anthropic", "vertex"] as const;
export type HarnessProvider = (typeof providerOptions)[number];

export const packNames = [
  "Bottleneck Map",
  "First-Customer Pipeline",
  "Founder Function Map",
  "Customer Learning Loop",
  "Trust Packet",
  "Agent Workflow Plan",
] as const;

export type PackName = (typeof packNames)[number];

export const workflowKeys = [
  "bottleneck_map",
  "first_customer_pipeline",
  "founder_function_map",
  "customer_learning_loop",
  "trust_packet",
  "agent_workflow_plan",
] as const;

export type WorkflowKey = (typeof workflowKeys)[number];

export const actionTypes = ["preview", "draft", "queue", "export"] as const;
export type ActionType = (typeof actionTypes)[number];

export const riskLevels = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof riskLevels)[number];

export const verificationStatuses = [
  "not_started",
  "pending",
  "succeeded",
  "failed",
  "needs_manual_confirmation",
] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

export type DiagnosticIntake = {
  provider: HarnessProvider;
  founderType: string;
  stage: string;
  offer: string;
  customerContext: string;
  bottleneck: string;
  recentAttempt: string;
  weeklyConstraint: string;
  trustBlocker: string;
  validationEvidence: string;
  criticalAssumption: string;
};

export type DiagnosticResult = {
  runId: string;
  provider: HarnessProvider;
  harnessVersion: string;
  createdAt: string;
  storage: RunStorageState;
  diagnosis: {
    primaryBottleneck: string;
    secondaryBottleneck: string;
    reasoning: string;
  };
  recommendedPack: {
    name: PackName;
    why: string;
    executionAsset: string;
  };
  notThisWeek: string[];
  assumptions: string[];
  risks: string[];
  missingContext: string[];
  recommendedActions: RecommendedAction[];
  evaluation: {
    score: number;
    recommendation: "approve" | "revise" | "reject";
  };
  approvalGate: {
    prompt: string;
  };
  agentHandoff: {
    workflowKey: WorkflowKey;
    contextBrief: string;
    nextAgentRoles: string[];
    approvalRequiredFor: string[];
    suggestedNextRun: string;
  };
};

export type RecommendedAction = {
  actionId: string;
  title: string;
  workflowKey: WorkflowKey;
  actionType: ActionType;
  status: ActionStatus;
  previewPayload: string;
  riskLevel: RiskLevel;
  approvalRequired: boolean;
  unsupportedClaims: string[];
  copyExportOutput: string;
  verificationStatus: VerificationStatus;
};

export type RunStorageState = {
  status: "stored" | "not_configured" | "failed";
  ownerToken?: string;
  message?: string;
};

export type ActionStatus =
  | "proposed"
  | "approved"
  | "revision_requested"
  | "rejected"
  | "copied"
  | "exported";

export type ApprovalDecision = "approve" | "revise" | "reject";

export const executionAssetStatuses = [
  "proposed",
  "approved",
  "revision_requested",
  "rejected",
] as const;
export type ExecutionAssetStatus = (typeof executionAssetStatuses)[number];

export const executionArtifactTypes = [
  "bottleneck_map",
  "first_customer_pipeline",
  "founder_function_map",
  "customer_learning_loop",
  "trust_packet",
  "agent_workflow_plan",
] as const;
export type ExecutionArtifactType = (typeof executionArtifactTypes)[number];

export type ExecutionAsset = {
  assetId: string;
  runId: string;
  workflowKey: WorkflowKey;
  artifactType: ExecutionArtifactType;
  title: string;
  content: string;
  assumptions: string[];
  risks: string[];
  unsupportedClaims: string[];
  nextSteps: string[];
  evaluation: {
    score: number;
    recommendation: "approve" | "revise" | "reject";
  };
  status: ExecutionAssetStatus;
  approvalPrompt: string;
  createdAt: string;
};

export type ToolPreviewType =
  | "email_compose"
  | "task_export"
  | "markdown_export"
  | "copy_diff"
  | "buyer_response";

export type ToolPreview = {
  previewId: string;
  actionId: string;
  previewType: ToolPreviewType;
  executionMode: "preview_only";
  payload: string;
};

export type ProviderCallOptions = {
  provider: HarnessProvider;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schema: JsonSchema;
};

export type JsonSchema = {
  type: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
};
