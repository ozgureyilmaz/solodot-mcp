import {
  actionTypes,
  packNames,
  riskLevels,
  verificationStatuses,
  workflowKeys,
  type DiagnosticIntake,
  type JsonSchema,
} from "./types";

export const diagnosticResultSchema = {
  type: "object",
  required: [
    "diagnosis",
    "recommendedPack",
    "notThisWeek",
    "assumptions",
    "risks",
    "missingContext",
    "recommendedActions",
    "evaluation",
    "approvalGate",
    "agentHandoff",
  ],
  properties: {
    diagnosis: {
      type: "object",
      required: ["primaryBottleneck", "secondaryBottleneck", "reasoning"],
      properties: {
        primaryBottleneck: { type: "string" },
        secondaryBottleneck: { type: "string" },
        reasoning: { type: "string" },
      },
    },
    recommendedPack: {
      type: "object",
      required: ["name", "why", "executionAsset"],
      properties: {
        name: { type: "string", enum: packNames },
        why: { type: "string" },
        executionAsset: { type: "string" },
      },
    },
    notThisWeek: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    missingContext: { type: "array", items: { type: "string" } },
    recommendedActions: {
      type: "array",
      items: {
        type: "object",
        required: [
          "title",
          "workflowKey",
          "actionType",
          "previewPayload",
          "riskLevel",
          "approvalRequired",
          "unsupportedClaims",
          "copyExportOutput",
          "verificationStatus",
        ],
        properties: {
          title: { type: "string" },
          workflowKey: { type: "string", enum: workflowKeys },
          actionType: { type: "string", enum: actionTypes },
          previewPayload: { type: "string" },
          riskLevel: { type: "string", enum: riskLevels },
          approvalRequired: { type: "boolean" },
          unsupportedClaims: { type: "array", items: { type: "string" } },
          copyExportOutput: { type: "string" },
          verificationStatus: {
            type: "string",
            enum: verificationStatuses,
          },
        },
      },
    },
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
    approvalGate: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
      },
    },
    agentHandoff: {
      type: "object",
      required: [
        "workflowKey",
        "contextBrief",
        "nextAgentRoles",
        "approvalRequiredFor",
        "suggestedNextRun",
      ],
      properties: {
        workflowKey: {
          type: "string",
          enum: workflowKeys,
        },
        contextBrief: { type: "string" },
        nextAgentRoles: { type: "array", items: { type: "string" } },
        approvalRequiredFor: { type: "array", items: { type: "string" } },
        suggestedNextRun: { type: "string" },
      },
    },
  },
} satisfies JsonSchema;

export function buildDiagnosticPrompt(intake: DiagnosticIntake) {
  const system = `You are Solodot's Painpoint Router Harness for solo founders.

Solodot identifies the active solo-founder painpoint, routes it to the right agent harness, and prepares one founder-approved action or execution asset. Diagnostic is only the intake/routing layer, not the product identity. Solodot does not act silently, send email, write to a CRM, publish, invoice, or automate compliance.

Run these harness stages internally:
1. Painpoint Router: classify the active painpoint.
2. Harness Planner: choose exactly one execution pack.
3. Execution Agent: draft one concrete action or asset the founder can use or edit this week.
4. Action Planner: turn the selected workflow into one preview-only action proposal.
5. Risk Evaluator: mark unsupported claims, missing context, and approval boundaries.
6. Evaluator Agent: score usefulness, specificity, risk, and founder-control from 0 to 100.
7. Approval Gate: ask the founder to approve, revise, or reject.

Allowed execution packs:
- Bottleneck Map
- First-Customer Pipeline
- Founder Function Map
- Customer Learning Loop
- Trust Packet
- Agent Workflow Plan

Rules:
- Choose the real painpoint, not just the stated complaint, when the evidence points elsewhere.
- If the founder has no paid customers, weak replies, unclear ICP, or no repeatable channel, prefer First-Customer Pipeline.
- Use Trust Packet only when an active buyer, procurement step, security review, support expectation, compliance question, or solo-founder continuity concern is blocking a serious B2B deal.
- Do not treat a general differentiation objection as Trust Packet when the founder still lacks first customers.
- Use Founder Function Map when delivery, admin, follow-ups, and sales compete for the same founder hour.
- Use Customer Learning Loop when activation, retention, churn, feedback synthesis, or product improvement from existing users is the main blocker.
- Use Agent Workflow Plan only when the founder already has several AI tools or agent roles but lacks coordination.
- Use Bottleneck Map when the evidence is mixed or insufficient.
- Treat validation evidence as stronger than stated intent. Interviews, paid pilots, copied assets, active users, failed tests, and real buyer objections should shape the diagnosis.
- If validation evidence is thin or missing, mark that as missing context or risk instead of implying traction.
- Use the critical assumption to sharpen the execution asset around a measurable test, metric, or founder decision this week.
- Keep the execution asset or action practical and specific to the founder context.
- Keep the whole response compact enough for an review UI.
- Use plain strings only. Do not use markdown tables, fenced code blocks, nested JSON strings, or long quoted passages inside string fields.
- Keep diagnosis.reasoning to 2 short sentences.
- Keep recommendedPack.why to 1 short sentence.
- Keep recommendedPack.executionAsset under 900 characters.
- Return 2 or 3 items in notThisWeek, assumptions, risks, missingContext, nextAgentRoles, and approvalRequiredFor.
- Return 1 or 2 recommendedActions. The first action is the primary proposed action.
- Every recommended action must stop at preview plus copy/export. It must not claim email sending, CRM updates, reminders created, publishing, invoice action, compliance automation, or external execution.
- Set recommendedActions.approvalRequired to true.
- Set recommendedActions.verificationStatus to not_started. Verification is future-only in this MVP.
- Use actionType draft for Trust Packet buyer-response previews.
- Use actionType queue or export for Follow-up Queue previews.
- Trust Packet actions must flag unsupported security, compliance, support, continuity, proof, or enterprise-readiness claims in unsupportedClaims.
- Follow-up Queue actions must not claim that emails were sent, a CRM was updated, or reminders were created.
- Keep each recommended action previewPayload and copyExportOutput under 900 characters.
- Keep agentHandoff.contextBrief under 300 characters.
- Keep agentHandoff.suggestedNextRun to 1 short sentence.
- Mark assumptions and risks explicitly.
- Mark missing context explicitly.
- Do not invent customer proof, revenue, testimonials, compliance posture, security claims, or integrations.
- Do not claim autonomous external action.
- Do not mention discussion-thread citations.
- Generate both the current execution asset and the agent handoff for the next harness run.
- Return only the structured object requested by the schema.`;

  const user = `Founder intake:

Founder type: ${intake.founderType}
Stage: ${intake.stage}
Current offer or product: ${intake.offer}
Customer / revenue context: ${intake.customerContext || "Not provided"}
Biggest stated bottleneck: ${intake.bottleneck}
Recent failed or stalled attempt: ${intake.recentAttempt}
Constraint this week: ${intake.weeklyConstraint}
Trust or sales blocker: ${intake.trustBlocker || "Not provided"}
Validation evidence so far: ${intake.validationEvidence || "Not provided"}
Critical assumption / test metric: ${intake.criticalAssumption || "Not provided"}

Return a diagnostic result with:
- primary and secondary bottleneck
- concise reasoning
- one recommended pack
- one compact execution asset under 900 characters
- what not to do this week
- assumptions
- risks
- missing context
- validation or metric gaps where relevant
- recommended action proposals with previewPayload, riskLevel, approvalRequired, unsupportedClaims, copyExportOutput, and future-only verificationStatus
- evaluator score from 0 to 100 and recommendation
- founder approval prompt
- agent handoff context for the next harnessed workflow`;

  return { system, user };
}
