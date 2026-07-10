import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  ActionStatus,
  ApprovalDecision,
  DiagnosticIntake,
  DiagnosticResult,
  ExecutionAsset,
  RecommendedAction,
  ToolPreviewType,
} from "./types";

type SupabaseConfig = {
  url: string;
  secretKey: string;
  tablePrefix: string;
};

export type PersistenceOutcome =
  | { status: "stored"; ownerToken: string }
  | { status: "not_configured"; message: string }
  | { status: "failed"; message: string };

export type ApprovalRecordInput = {
  runId: string;
  actionId: string;
  ownerToken: string;
  decision: ApprovalDecision;
  reason: string;
};

export class RunPersistenceError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
  ) {
    super(message);
    this.name = "RunPersistenceError";
  }
}

export function getRunPersistenceConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const tablePrefix =
    process.env.SUPABASE_AGENT_TABLE_PREFIX?.trim() || "solodot_";

  if (!url || !secretKey) return null;
  return { url, secretKey, tablePrefix };
}

export async function persistDiagnosticRun({
  intake,
  result,
}: {
  intake: DiagnosticIntake;
  result: DiagnosticResult;
}): Promise<DiagnosticResult> {
  const outcome = await tryPersistDiagnosticRun({ intake, result });

  return {
    ...result,
    storage: outcome,
  };
}

export async function tryPersistDiagnosticRun({
  intake,
  result,
  ownerToken: suppliedOwnerToken,
}: {
  intake: DiagnosticIntake;
  result: DiagnosticResult;
  ownerToken?: string;
}): Promise<PersistenceOutcome> {
  const config = getRunPersistenceConfig();

  if (!config) {
    return {
      status: "not_configured",
      message:
        "Supabase run persistence is not configured. This diagnostic can still be approved and copied locally.",
    };
  }

  const ownerToken = suppliedOwnerToken || createOwnerToken();
  const ownerTokenHash = hashOwnerToken(ownerToken);

  try {
    await supabaseInsert(config, "agent_runs", {
      id: result.runId,
      owner_token_hash: ownerTokenHash,
      status: "diagnostic_complete",
      provider: result.provider,
      harness_version: result.harnessVersion,
      workflow_key: result.agentHandoff.workflowKey,
      context_brief: result.agentHandoff.contextBrief,
      diagnostic_result: withoutOwnerToken(result),
      intake_brief: toIntakeBrief(intake),
      created_at: result.createdAt,
    });

    await supabaseInsert(
      config,
      "artifacts",
      {
        id: `art_${result.runId}_diagnostic`,
        run_id: result.runId,
        owner_token_hash: ownerTokenHash,
        artifact_type: "diagnostic_result",
        title: result.diagnosis.primaryBottleneck,
        content: result.recommendedPack.executionAsset,
        payload: withoutOwnerToken(result),
        created_at: result.createdAt,
      },
      { ignoreDuplicates: true },
    );

    await Promise.all(
      result.recommendedActions.map((action) =>
        persistRecommendedAction({
          config,
          runId: result.runId,
          ownerTokenHash,
          action,
          createdAt: result.createdAt,
        }),
      ),
    );

    return { status: "stored", ownerToken };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      status: "failed",
      message: `Run persistence failed. The diagnostic is still usable locally. ${message}`,
    };
  }
}

export async function persistExecutionAsset({
  asset,
  ownerToken,
}: {
  asset: ExecutionAsset;
  ownerToken: string;
}) {
  const config = requireRunPersistenceConfig();
  const ownerTokenHash = hashOwnerToken(ownerToken);
  await getRun(config, asset.runId, ownerTokenHash);

  await supabaseInsert(
    config,
    "recommended_actions",
    {
      id: asset.assetId,
      run_id: asset.runId,
      owner_token_hash: ownerTokenHash,
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
    { ignoreDuplicates: true },
  );

  await supabaseInsert(
    config,
    "artifacts",
    {
      id: asset.assetId,
      run_id: asset.runId,
      owner_token_hash: ownerTokenHash,
      artifact_type: asset.artifactType,
      title: asset.title,
      content: asset.content,
      payload: asset,
      created_at: asset.createdAt,
    },
    { ignoreDuplicates: true },
  );

  await supabasePatch(
    config,
    "agent_runs",
    `id=eq.${encodeURIComponent(asset.runId)}&owner_token_hash=eq.${encodeURIComponent(ownerTokenHash)}`,
    { status: "execution_asset_proposed", updated_at: asset.createdAt },
  );

  return asset;
}

export async function getPersistedRunSnapshot({
  runId,
  ownerToken,
}: {
  runId: string;
  ownerToken: string;
}) {
  const config = requireRunPersistenceConfig();
  const ownerTokenHash = hashOwnerToken(ownerToken);
  const run = await getRun(config, runId, ownerTokenHash);
  const actions = await supabaseSelect<Record<string, unknown>>(
    config,
    "recommended_actions",
    `run_id=eq.${encodeURIComponent(runId)}&owner_token_hash=eq.${encodeURIComponent(ownerTokenHash)}&select=*&order=created_at.asc`,
  );
  const approvals = await supabaseSelect<Record<string, unknown>>(
    config,
    "approval_requests",
    `run_id=eq.${encodeURIComponent(runId)}&owner_token_hash=eq.${encodeURIComponent(ownerTokenHash)}&select=*&order=created_at.asc`,
  );
  const artifacts = await supabaseSelect<Record<string, unknown>>(
    config,
    "artifacts",
    `run_id=eq.${encodeURIComponent(runId)}&owner_token_hash=eq.${encodeURIComponent(ownerTokenHash)}&select=*&order=created_at.asc`,
  );

  return { run, actions, approvals, artifacts };
}

export async function recordApproval(input: ApprovalRecordInput) {
  const config = requireRunPersistenceConfig();
  const ownerTokenHash = hashOwnerToken(input.ownerToken);
  const run = await getRun(config, input.runId, ownerTokenHash);
  const action = await getAction(config, input.actionId, input.runId);
  const status = approvalDecisionToStatus(input.decision);
  const now = new Date().toISOString();
  const warnings: string[] = [];
  const approvalId = createStableRecordId("appr", [
    input.runId,
    input.actionId,
    input.decision,
    input.reason,
  ]);

  await supabaseInsert(
    config,
    "approval_requests",
    {
      id: approvalId,
      run_id: input.runId,
      action_id: input.actionId,
      owner_token_hash: ownerTokenHash,
      decision: input.decision,
      reason: input.reason || null,
      preview_payload: action.preview_payload,
      copy_export_output: action.copy_export_output,
      created_at: now,
    },
    { ignoreDuplicates: true },
  );

  await supabasePatch(
    config,
    "recommended_actions",
    `id=eq.${encodeURIComponent(input.actionId)}&run_id=eq.${encodeURIComponent(input.runId)}`,
    {
      status,
      updated_at: now,
    },
  );

  await supabasePatch(
    config,
    "agent_runs",
    `id=eq.${encodeURIComponent(input.runId)}&owner_token_hash=eq.${encodeURIComponent(ownerTokenHash)}`,
    {
      status:
        input.decision === "approve"
          ? "waiting_for_copy_export"
          : input.decision === "revise"
            ? "revision_requested"
            : "rejected",
      updated_at: now,
    },
  );

  const previewType = inferToolPreviewType(action);

  await collectPersistenceWarning(
    warnings,
    "Tool preview could not be recorded.",
    supabaseInsert(
      config,
      "tool_previews",
      {
        id: createStableRecordId("prev", [
          input.runId,
          input.actionId,
          input.decision,
        ]),
        run_id: input.runId,
        action_id: input.actionId,
        preview_type: previewType,
        execution_mode: "preview_only",
        payload: action.copy_export_output,
        created_at: now,
      },
      { ignoreDuplicates: true },
    ),
  );

  if (input.decision === "approve") {
    await collectPersistenceWarning(
      warnings,
      "Approved artifact could not be recorded.",
      supabaseInsert(
        config,
        "artifacts",
        {
          id: createStableRecordId("art", [input.runId, input.actionId]),
          run_id: input.runId,
          owner_token_hash: ownerTokenHash,
          artifact_type: previewType,
          title: action.title,
          content: action.copy_export_output,
          payload: {
            run,
            action,
            approvalDecision: input.decision,
            executionMode: "preview_only",
          },
          created_at: now,
        },
        { ignoreDuplicates: true },
      ),
    );
  }

  return {
    ok: true,
    actionStatus: status,
    copyExportOutput: String(action.copy_export_output || ""),
    previewType,
    warnings,
  };
}

export async function markActionCopied({
  runId,
  actionId,
  ownerToken,
  status,
}: {
  runId: string;
  actionId: string;
  ownerToken: string;
  status: Extract<ActionStatus, "copied" | "exported">;
}) {
  const config = requireRunPersistenceConfig();
  const ownerTokenHash = hashOwnerToken(ownerToken);
  await getRun(config, runId, ownerTokenHash);
  await getAction(config, actionId, runId);

  await supabasePatch(
    config,
    "recommended_actions",
    `id=eq.${encodeURIComponent(actionId)}&run_id=eq.${encodeURIComponent(runId)}`,
    {
      status,
      updated_at: new Date().toISOString(),
    },
  );

  return { ok: true, actionStatus: status };
}

export async function exportRun({
  runId,
  ownerToken,
}: {
  runId: string;
  ownerToken: string;
}) {
  const config = requireRunPersistenceConfig();
  const ownerTokenHash = hashOwnerToken(ownerToken);
  const run = await getRun(config, runId, ownerTokenHash);
  const actions = await supabaseSelect<Record<string, unknown>>(
    config,
    "recommended_actions",
    `run_id=eq.${encodeURIComponent(runId)}&select=*&order=created_at.asc`,
  );
  const approvals = await supabaseSelect<Record<string, unknown>>(
    config,
    "approval_requests",
    `run_id=eq.${encodeURIComponent(runId)}&owner_token_hash=eq.${encodeURIComponent(ownerTokenHash)}&select=*&order=created_at.asc`,
  );
  const artifacts = await supabaseSelect<Record<string, unknown>>(
    config,
    "artifacts",
    `run_id=eq.${encodeURIComponent(runId)}&owner_token_hash=eq.${encodeURIComponent(ownerTokenHash)}&select=*&order=created_at.asc`,
  );

  return {
    exportedAt: new Date().toISOString(),
    executionMode: "preview_only",
    run,
    actions,
    approvals,
    artifacts,
  };
}

export async function deleteRun({
  runId,
  ownerToken,
}: {
  runId: string;
  ownerToken: string;
}) {
  const config = requireRunPersistenceConfig();
  const ownerTokenHash = hashOwnerToken(ownerToken);
  await getRun(config, runId, ownerTokenHash);

  const runFilter = `run_id=eq.${encodeURIComponent(runId)}`;
  await supabaseDelete(config, "tool_previews", runFilter);
  await supabaseDelete(config, "approval_requests", runFilter);
  await supabaseDelete(config, "recommended_actions", runFilter);
  await supabaseDelete(config, "verification_results", runFilter);
  await supabaseDelete(config, "memory_items", runFilter);
  await supabaseDelete(config, "eval_cases", runFilter);
  await supabaseDelete(config, "artifacts", runFilter);
  await supabaseDelete(
    config,
    "agent_runs",
    `id=eq.${encodeURIComponent(runId)}&owner_token_hash=eq.${encodeURIComponent(ownerTokenHash)}`,
  );

  return { ok: true };
}

function requireRunPersistenceConfig() {
  const config = getRunPersistenceConfig();
  if (!config) {
    throw new RunPersistenceError("Run persistence is not configured.", 503);
  }
  return config;
}

async function persistRecommendedAction({
  config,
  runId,
  ownerTokenHash,
  action,
  createdAt,
}: {
  config: SupabaseConfig;
  runId: string;
  ownerTokenHash: string;
  action: RecommendedAction;
  createdAt: string;
}) {
  await supabaseInsert(config, "recommended_actions", {
    id: action.actionId,
    run_id: runId,
    owner_token_hash: ownerTokenHash,
    title: action.title,
    workflow_key: action.workflowKey,
    action_type: action.actionType,
    status: action.status,
    preview_payload: action.previewPayload,
    risk_level: action.riskLevel,
    approval_required: action.approvalRequired,
    unsupported_claims: action.unsupportedClaims,
    copy_export_output: action.copyExportOutput,
    verification_status: action.verificationStatus,
    created_at: createdAt,
  });
}

function createOwnerToken() {
  return `${randomUUID()}.${randomBytes(24).toString("base64url")}`;
}

function hashOwnerToken(ownerToken: string) {
  return createHash("sha256").update(ownerToken).digest("hex");
}

function createStableRecordId(prefix: string, parts: string[]) {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex");
  return `${prefix}_${digest.slice(0, 24)}`;
}

async function collectPersistenceWarning(
  warnings: string[],
  message: string,
  operation: Promise<unknown>,
) {
  try {
    await operation;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    warnings.push(`${message} ${detail}`);
  }
}

function toIntakeBrief(intake: DiagnosticIntake) {
  return {
    founderType: intake.founderType,
    stage: intake.stage,
    offer: intake.offer,
    customerContext: intake.customerContext,
    bottleneck: intake.bottleneck,
    recentAttempt: intake.recentAttempt,
    weeklyConstraint: intake.weeklyConstraint,
    trustBlocker: intake.trustBlocker,
    validationEvidence: intake.validationEvidence,
    criticalAssumption: intake.criticalAssumption,
  };
}

function withoutOwnerToken(result: DiagnosticResult) {
  return {
    ...result,
    storage: {
      status: result.storage.status,
      message: result.storage.message,
    },
  };
}

function approvalDecisionToStatus(decision: ApprovalDecision): ActionStatus {
  if (decision === "approve") return "approved";
  if (decision === "revise") return "revision_requested";
  return "rejected";
}

function inferToolPreviewType(action: Record<string, unknown>): ToolPreviewType {
  if (action.workflow_key === "trust_packet") return "buyer_response";
  if (action.action_type === "queue" || action.action_type === "export") {
    return "task_export";
  }
  return "markdown_export";
}

async function getRun(
  config: SupabaseConfig,
  runId: string,
  ownerTokenHash: string,
) {
  const rows = await supabaseSelect<Record<string, unknown>>(
    config,
    "agent_runs",
    `id=eq.${encodeURIComponent(runId)}&owner_token_hash=eq.${encodeURIComponent(ownerTokenHash)}&select=*`,
  );

  if (rows.length === 0) {
    throw new RunPersistenceError("Run was not found for this owner token.", 404);
  }

  return rows[0];
}

async function getAction(config: SupabaseConfig, actionId: string, runId: string) {
  const rows = await supabaseSelect<Record<string, unknown>>(
    config,
    "recommended_actions",
    `id=eq.${encodeURIComponent(actionId)}&run_id=eq.${encodeURIComponent(runId)}&select=*`,
  );

  if (rows.length === 0) {
    throw new RunPersistenceError("Recommended action was not found.", 404);
  }

  return rows[0];
}

async function supabaseInsert(
  config: SupabaseConfig,
  table: string,
  record: Record<string, unknown>,
  options: { ignoreDuplicates?: boolean } = {},
) {
  const headers = supabaseHeaders(config, {
    Prefer: options.ignoreDuplicates
      ? "return=minimal,resolution=ignore-duplicates"
      : "return=minimal",
  });
  const url = supabaseUrl(config, table);
  if (options.ignoreDuplicates) {
    url.searchParams.set("on_conflict", "id");
  }
  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(record),
  });
  await assertSupabaseOk(response, `insert ${table}`);
}

async function supabaseSelect<T>(
  config: SupabaseConfig,
  table: string,
  query: string,
): Promise<T[]> {
  const url = supabaseUrl(config, table);
  url.search = query;
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: supabaseHeaders(config),
  });
  await assertSupabaseOk(response, `select ${table}`);
  return (await response.json()) as T[];
}

async function supabasePatch(
  config: SupabaseConfig,
  table: string,
  query: string,
  record: Record<string, unknown>,
) {
  const url = supabaseUrl(config, table);
  url.search = query;
  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: supabaseHeaders(config, { Prefer: "return=minimal" }),
    body: JSON.stringify(record),
  });
  await assertSupabaseOk(response, `update ${table}`);
}

async function supabaseDelete(
  config: SupabaseConfig,
  table: string,
  query: string,
) {
  const url = supabaseUrl(config, table);
  url.search = query;
  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: supabaseHeaders(config, { Prefer: "return=minimal" }),
  });
  await assertSupabaseOk(response, `delete ${table}`);
}

function supabaseUrl(config: SupabaseConfig, table: string) {
  return new URL(`/rest/v1/${config.tablePrefix}${table}`, config.url);
}

function supabaseHeaders(
  config: SupabaseConfig,
  extra: Record<string, string> = {},
) {
  return {
    apikey: config.secretKey,
    Authorization: `Bearer ${config.secretKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function assertSupabaseOk(response: Response, operation: string) {
  if (!response.ok) {
    const detail = await response.text();
    throw new RunPersistenceError(
      `Supabase ${operation} failed (${response.status}). ${detail}`,
      response.status,
    );
  }
}
