import { createHash } from "node:crypto";
import type {
  ApprovalDecision,
  DiagnosticIntake,
  DiagnosticResult,
  ExecutionAsset,
} from "./types";

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
  workspaceId: string;
  userId: string;
};

export type PersistenceOutcome =
  | { status: "stored" }
  | { status: "not_configured"; message: string }
  | { status: "failed"; message: string };

export type ApprovalRecordInput = {
  runId: string;
  actionId: string;
  decision: ApprovalDecision;
  reason: string;
};

export function getRunPersistenceConfig(): SupabaseConfig | null {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const workspaceId = process.env.SOLODOT_MCP_WORKSPACE_ID?.trim();
  const userId = process.env.SOLODOT_MCP_USER_ID?.trim();
  if (!url || !serviceRoleKey || !workspaceId || !userId) return null;
  return { url, serviceRoleKey, workspaceId, userId };
}

export async function tryPersistDiagnosticRun({
  intake,
  result,
}: {
  intake: DiagnosticIntake;
  result: DiagnosticResult;
}): Promise<PersistenceOutcome> {
  const config = getRunPersistenceConfig();
  if (!config) {
    return {
      status: "not_configured",
      message: "Durable MCP storage requires Supabase plus an explicit workspace and user id.",
    };
  }
  try {
    await insert(config, "solodot_agent_runs", {
      id: result.runId,
      workspace_id: config.workspaceId,
      created_by: config.userId,
      status: "awaiting_founder_approval",
      harness_version: result.harnessVersion,
      workflow_key: result.agentHandoff.workflowKey,
      context_brief: result.agentHandoff.contextBrief,
      diagnostic_result: result,
      intake_brief: intake,
      orchestration_mode: result.routing.mode,
      routing_decision: result.routing,
      created_at: result.createdAt,
    });
    return { status: "stored" };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Diagnostic could not be stored.",
    };
  }
}

export async function persistExecutionAsset({ asset }: { asset: ExecutionAsset }) {
  const config = requireConfig();
  await getRun(config, asset.runId);
  await insert(
    config,
    "solodot_recommended_actions",
    {
      id: asset.assetId,
      workspace_id: config.workspaceId,
      created_by: config.userId,
      run_id: asset.runId,
      title: asset.title,
      workflow_key: asset.workflowKey,
      action_type: "draft",
      status: asset.status,
      preview_payload: asset.content,
      risk_level: asset.risks.length > 2 ? "medium" : "low",
      approval_required: true,
      unsupported_claims: asset.unsupportedClaims,
      copy_export_output: asset.content,
      verification_status: "not_started",
      created_at: asset.createdAt,
    },
    true,
  );
  await insert(
    config,
    "solodot_artifacts",
    {
      id: asset.assetId,
      workspace_id: config.workspaceId,
      created_by: config.userId,
      run_id: asset.runId,
      artifact_type: asset.artifactType,
      title: asset.title,
      content: asset.content,
      payload: asset,
      created_at: asset.createdAt,
    },
    true,
  );
}

export async function getPersistedRunSnapshot({ runId }: { runId: string }) {
  const config = requireConfig();
  const run = await getRun(config, runId);
  const query = `run_id=eq.${encodeURIComponent(runId)}&workspace_id=eq.${encodeURIComponent(config.workspaceId)}&select=*&order=created_at.asc`;
  const [actions, approvals, artifacts] = await Promise.all([
    select(config, "solodot_recommended_actions", query),
    select(config, "solodot_approval_requests", query),
    select(config, "solodot_artifacts", query),
  ]);
  return { run, actions, approvals, artifacts };
}

export async function recordApproval(input: ApprovalRecordInput) {
  const config = requireConfig();
  await getRun(config, input.runId);
  const actions = await select(
    config,
    "solodot_recommended_actions",
    `id=eq.${encodeURIComponent(input.actionId)}&run_id=eq.${encodeURIComponent(input.runId)}&workspace_id=eq.${encodeURIComponent(config.workspaceId)}&select=*`,
  );
  const action = actions[0];
  if (!action) throw new Error("Execution asset was not found.");
  const status = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "revision_requested";
  await insert(
    config,
    "solodot_approval_requests",
    {
      id: stableId([input.runId, input.actionId, input.decision, input.reason]),
      workspace_id: config.workspaceId,
      created_by: config.userId,
      run_id: input.runId,
      action_id: input.actionId,
      approval_type: "founder_action",
      decision: input.decision,
      reason: input.reason || null,
      preview_payload: action.preview_payload,
      copy_export_output: action.copy_export_output,
    },
    true,
  );
  await patch(
    config,
    "solodot_recommended_actions",
    `id=eq.${encodeURIComponent(input.actionId)}&workspace_id=eq.${encodeURIComponent(config.workspaceId)}`,
    { status, updated_at: new Date().toISOString() },
  );
}

function requireConfig() {
  const config = getRunPersistenceConfig();
  if (!config) throw new Error("Supabase workspace persistence is not configured.");
  return config;
}

async function getRun(config: SupabaseConfig, runId: string) {
  const runs = await select(
    config,
    "solodot_agent_runs",
    `id=eq.${encodeURIComponent(runId)}&workspace_id=eq.${encodeURIComponent(config.workspaceId)}&select=*`,
  );
  if (!runs[0]) throw new Error("Solodot run was not found for this workspace.");
  return runs[0];
}

async function insert(
  config: SupabaseConfig,
  table: string,
  body: Record<string, unknown>,
  ignoreDuplicates = false,
) {
  const query = ignoreDuplicates ? "?on_conflict=id" : "";
  const response = await fetch(`${config.url}/rest/v1/${table}${query}`, {
    method: "POST",
    headers: headers(config, ignoreDuplicates ? "resolution=ignore-duplicates" : undefined),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
}

async function select(config: SupabaseConfig, table: string, query: string) {
  const response = await fetch(`${config.url}/rest/v1/${table}?${query}`, {
    headers: headers(config),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as Array<Record<string, unknown>>;
}

async function patch(
  config: SupabaseConfig,
  table: string,
  query: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${config.url}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: headers(config),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
}

function headers(config: SupabaseConfig, prefer?: string) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function stableId(parts: string[]) {
  return `appr_${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 28)}`;
}
