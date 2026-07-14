import {
  HARNESS_VERSION,
  actionTypes,
  packNames,
  riskLevels,
  workflowKeys,
  type DiagnosticIntake,
  type DiagnosticResult,
  type PackName,
  type RecommendedAction,
  type WorkflowKey,
} from "./types";
import { routeExecutionPack } from "../runtime/routing";

const MAX_TEXT = 1800;
const MAX_ACTIONS = 2;

const unsafeExternalActionPattern =
  /\b(sent|emailed|delivered|published|posted|updated|created|scheduled|filed|charged|invoiced|processed|executed|synced|wrote to|added to|removed from)\b/i;

const unsafeSystemPattern =
  /\b(email|emails|crm|salesforce|hubspot|stripe|quickbooks|xero|gmail|outlook|calendar|reminder|reminders|notion|linear|jira|slack|website|invoice|invoices|payment|payments)\b/i;

export function parseDiagnosticIntake(input: unknown): DiagnosticIntake {
  const body = asRecord(input);

  const intake: DiagnosticIntake = {
    founderType: cleanRequired(body.founderType, "Founder type"),
    stage: cleanRequired(body.stage, "Stage"),
    offer: cleanRequired(body.offer, "Current offer or product"),
    customerContext: cleanOptional(body.customerContext),
    bottleneck: cleanRequired(body.bottleneck, "Biggest bottleneck"),
    recentAttempt: cleanRequired(body.recentAttempt, "Recent attempt"),
    weeklyConstraint: cleanRequired(body.weeklyConstraint, "Weekly constraint"),
    trustBlocker: cleanOptional(body.trustBlocker),
    validationEvidence: cleanOptional(body.validationEvidence),
    criticalAssumption: cleanOptional(body.criticalAssumption),
  };

  return intake;
}

export function normalizeDiagnosticResult({
  raw,
  runId,
  createdAt = new Date().toISOString(),
}: {
  raw: unknown;
  runId: string;
  createdAt?: string;
}): DiagnosticResult {
  const body = asRecord(raw);
  const diagnosis = asRecord(body.diagnosis);
  const recommendedPack = asRecord(body.recommendedPack);
  const evaluation = asRecord(body.evaluation);
  const approvalGate = asRecord(body.approvalGate);
  const agentHandoff = asRecord(body.agentHandoff);
  const packName = normalizePackName(recommendedPack.name);
  const workflowKey = normalizeWorkflowKey(agentHandoff.workflowKey, packName);
  const executionAsset =
    cleanOptional(recommendedPack.executionAsset) ||
    "Draft a one-week action plan and review it with the founder before using it.";
  const risks = cleanList(body.risks, [
    "The recommendation may change after a live founder correction.",
  ]);
  const missingContext = cleanList(body.missingContext, [
    "The founder should confirm the exact customer, buyer, or workflow context before using the output.",
  ]);

  return {
    runId,
    harnessVersion: HARNESS_VERSION,
    createdAt,
    routing: routeExecutionPack(workflowKey, readMaxWorkers()),
    storage: {
      status: "not_configured",
      message: "Run persistence has not been attempted.",
    },
    diagnosis: {
      primaryBottleneck:
        cleanOptional(diagnosis.primaryBottleneck) || "Unclear bottleneck",
      secondaryBottleneck:
        cleanOptional(diagnosis.secondaryBottleneck) || "Needs follow-up context",
      reasoning:
        cleanOptional(diagnosis.reasoning) ||
        "The intake did not include enough usable context for a confident diagnosis.",
    },
    recommendedPack: {
      name: packName,
      why:
        cleanOptional(recommendedPack.why) ||
        "This pack best matches the current bottleneck evidence.",
      executionAsset,
    },
    notThisWeek: cleanList(body.notThisWeek, [
      "Do not add broad automation before the bottleneck is confirmed.",
    ]),
    assumptions: cleanList(body.assumptions, [
      "The intake is enough to make a first diagnostic guess.",
    ]),
    risks,
    missingContext,
    recommendedActions: normalizeRecommendedActions({
      value: body.recommendedActions,
      packName,
      workflowKey,
      executionAsset,
      risks,
      missingContext,
    }),
    evaluation: {
      score: clampScore(evaluation.score),
      recommendation: normalizeRecommendation(evaluation.recommendation),
    },
    approvalGate: {
      prompt:
        cleanOptional(approvalGate.prompt) ||
        "Approve, revise, or reject this execution asset before taking action.",
    },
    agentHandoff: {
      workflowKey,
      contextBrief:
        cleanOptional(agentHandoff.contextBrief) ||
        "Use the routed painpoint result as the context brief for the next harnessed agent workflow.",
      nextAgentRoles: cleanList(agentHandoff.nextAgentRoles, [
        "Painpoint Router",
        "Planner",
        "Generator",
        "Evaluator",
      ]),
      approvalRequiredFor: cleanList(agentHandoff.approvalRequiredFor, [
        "Any public, customer-facing, financial, or irreversible action",
      ]),
      suggestedNextRun:
        cleanOptional(agentHandoff.suggestedNextRun) ||
        `Run the ${packName} harness with the founder-approved context.`,
    },
  };
}

export function safeParseJSON(text: string): unknown {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const cleaned = (match ? match[1] : text).trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown parse error";
    throw new Error(
      `OpenAI returned invalid structured JSON (${reason}). Try again with a shorter intake.`,
    );
  }
}

function readMaxWorkers() {
  const value = Number.parseInt(process.env.SOLODOT_MAX_WORKERS || "8", 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(value, 64)) : 8;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanRequired(value: unknown, label: string) {
  const cleaned = cleanOptional(value);
  if (cleaned.length < 2) {
    throw new Error(`${label} is required.`);
  }
  return cleaned;
}

function cleanOptional(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

function cleanList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map(cleanOptional)
    .filter(Boolean)
    .slice(0, 6);
  return items.length > 0 ? items : fallback;
}

function normalizeRecommendedActions({
  value,
  packName,
  workflowKey,
  executionAsset,
  risks,
  missingContext,
}: {
  value: unknown;
  packName: PackName;
  workflowKey: WorkflowKey;
  executionAsset: string;
  risks: string[];
  missingContext: string[];
}): RecommendedAction[] {
  if (!Array.isArray(value)) {
    return [
      buildFallbackAction({
        packName,
        workflowKey,
        executionAsset,
        risks,
        missingContext,
      }),
    ];
  }

  const actions = value
    .map((item) =>
      normalizeRecommendedAction({
        value: item,
        packName,
        workflowKey,
        executionAsset,
        risks,
        missingContext,
      }),
    )
    .slice(0, MAX_ACTIONS);

  return actions.length > 0
    ? actions
    : [
        buildFallbackAction({
          packName,
          workflowKey,
          executionAsset,
          risks,
          missingContext,
        }),
      ];
}

function normalizeRecommendedAction({
  value,
  packName,
  workflowKey,
  executionAsset,
  risks,
  missingContext,
}: {
  value: unknown;
  packName: PackName;
  workflowKey: WorkflowKey;
  executionAsset: string;
  risks: string[];
  missingContext: string[];
}): RecommendedAction {
  const action = asRecord(value);
  const normalizedWorkflowKey = normalizeWorkflowKey(
    action.workflowKey,
    packName,
  );
  const previewPayload = cleanOptional(action.previewPayload);
  const copyExportOutput = cleanOptional(action.copyExportOutput);

  if (
    !previewPayload ||
    !copyExportOutput ||
    hasUnsafeExternalActionClaim(previewPayload) ||
    hasUnsafeExternalActionClaim(copyExportOutput)
  ) {
    return buildFallbackAction({
      packName,
      workflowKey: normalizedWorkflowKey || workflowKey,
      executionAsset,
      risks,
      missingContext,
    });
  }

  return {
    title:
      cleanOptional(action.title) ||
      fallbackActionTitle(packName, normalizedWorkflowKey),
    actionId: createActionId(normalizedWorkflowKey),
    workflowKey: normalizedWorkflowKey,
    actionType: normalizeActionType(action.actionType, normalizedWorkflowKey),
    status: "proposed",
    previewPayload,
    riskLevel: normalizeRiskLevel(action.riskLevel, normalizedWorkflowKey),
    approvalRequired: true,
    unsupportedClaims: normalizeUnsupportedClaims({
      value: action.unsupportedClaims,
      workflowKey: normalizedWorkflowKey,
    }),
    copyExportOutput,
    verificationStatus: normalizeVerificationStatus(),
  };
}

function buildFallbackAction({
  packName,
  workflowKey,
  executionAsset,
  risks,
  missingContext,
}: {
  packName: PackName;
  workflowKey: WorkflowKey;
  executionAsset: string;
  risks: string[];
  missingContext: string[];
}): RecommendedAction {
  const isTrustPacket = workflowKey === "trust_packet";
  const isFollowUpQueue = workflowKey === "founder_function_map";
  const title = fallbackActionTitle(packName, workflowKey);
  const boundary =
    "Founder approval required. Solodot has not sent, published, updated, scheduled, or created anything externally.";
  const previewPayload = `${executionAsset}\n\n${boundary}`.slice(0, MAX_TEXT);

  return {
    title,
    actionId: createActionId(workflowKey),
    workflowKey,
    actionType: isTrustPacket ? "draft" : isFollowUpQueue ? "queue" : "preview",
    status: "proposed",
    previewPayload,
    riskLevel: isTrustPacket ? "high" : isFollowUpQueue ? "medium" : "low",
    approvalRequired: true,
    unsupportedClaims: isTrustPacket
      ? [
          "Security, compliance, support, continuity, and proof claims need founder confirmation.",
          ...risks.slice(0, 2),
        ].slice(0, 3)
      : [
          "No emails sent, CRM records updated, reminders created, or external systems changed.",
          ...missingContext.slice(0, 2),
        ].slice(0, 3),
    copyExportOutput: previewPayload,
    verificationStatus: "not_started",
  };
}

function fallbackActionTitle(packName: PackName, workflowKey: WorkflowKey) {
  if (workflowKey === "trust_packet") {
    return "Approval-ready buyer response";
  }

  if (workflowKey === "founder_function_map") {
    return "Follow-up queue preview";
  }

  return `${packName} action preview`;
}

function normalizeActionType(
  value: unknown,
  workflowKey: WorkflowKey,
): RecommendedAction["actionType"] {
  if (
    typeof value === "string" &&
    actionTypes.includes(value as RecommendedAction["actionType"])
  ) {
    return value as RecommendedAction["actionType"];
  }

  if (workflowKey === "trust_packet") return "draft";
  if (workflowKey === "founder_function_map") return "queue";
  return "preview";
}

function normalizeRiskLevel(
  value: unknown,
  workflowKey: WorkflowKey,
): RecommendedAction["riskLevel"] {
  if (
    typeof value === "string" &&
    riskLevels.includes(value as RecommendedAction["riskLevel"])
  ) {
    return value as RecommendedAction["riskLevel"];
  }

  if (workflowKey === "trust_packet") return "high";
  if (workflowKey === "founder_function_map") return "medium";
  return "low";
}

function normalizeUnsupportedClaims({
  value,
  workflowKey,
}: {
  value: unknown;
  workflowKey: WorkflowKey;
}) {
  const trustFallback = [
    "Confirm security, compliance, support, continuity, and buyer-proof claims before use.",
  ];
  const generalFallback = [
    "No external action has happened; the founder must manually copy, export, or enter this work.",
  ];

  if (workflowKey === "trust_packet") {
    return [...trustFallback, ...cleanList(value, [])].slice(0, 4);
  }

  return cleanList(value, generalFallback);
}

function normalizeVerificationStatus(): RecommendedAction["verificationStatus"] {
  return "not_started";
}

function hasUnsafeExternalActionClaim(value: string) {
  return (
    unsafeExternalActionPattern.test(value) && unsafeSystemPattern.test(value)
  );
}

function createActionId(workflowKey: WorkflowKey) {
  return `act_${workflowKey}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function normalizePackName(value: unknown): PackName {
  if (typeof value === "string" && packNames.includes(value as PackName)) {
    return value as PackName;
  }
  return "Bottleneck Map";
}

function normalizeWorkflowKey(value: unknown, packName: PackName): WorkflowKey {
  if (
    typeof value === "string" &&
    workflowKeys.includes(value as WorkflowKey)
  ) {
    return value as WorkflowKey;
  }

  const fallback: Record<PackName, WorkflowKey> = {
    "Bottleneck Map": "bottleneck_map",
    "First-Customer Pipeline": "first_customer_pipeline",
    "Founder Function Map": "founder_function_map",
    "Customer Learning Loop": "customer_learning_loop",
    "Trust Packet": "trust_packet",
    "Agent Workflow Plan": "agent_workflow_plan",
  };

  return fallback[packName];
}

function clampScore(value: unknown) {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return 60;
  const normalized = score > 0 && score <= 1 ? score * 100 : score;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function normalizeRecommendation(value: unknown) {
  if (value === "approve" || value === "revise" || value === "reject") {
    return value;
  }
  return "revise";
}
