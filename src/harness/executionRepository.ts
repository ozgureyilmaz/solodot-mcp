import {
  getPersistedRunSnapshot,
  getRunPersistenceConfig,
  persistExecutionAsset,
  recordApproval,
  tryPersistDiagnosticRun,
} from "./persistence";
import type {
  ApprovalDecision,
  DiagnosticIntake,
  DiagnosticResult,
  ExecutionAsset,
  ExecutionAssetStatus,
} from "./types";

export type ExecutionApproval = {
  assetId: string;
  decision: ApprovalDecision;
  reason: string;
  createdAt: string;
};

export type SolodotRunRecord = {
  intake: DiagnosticIntake;
  diagnostic: DiagnosticResult;
  assets: ExecutionAsset[];
  approvals: ExecutionApproval[];
};

export interface ExecutionRepository {
  readonly durable: boolean;
  saveDiagnostic(
    principal: string,
    intake: DiagnosticIntake,
    diagnostic: DiagnosticResult,
  ): Promise<void>;
  getRun(principal: string, runId: string): Promise<SolodotRunRecord>;
  saveAsset(principal: string, asset: ExecutionAsset): Promise<void>;
  reviewAsset(
    principal: string,
    runId: string,
    assetId: string,
    decision: ApprovalDecision,
    reason: string,
  ): Promise<ExecutionAsset>;
}

export class RunNotFoundError extends Error {
  constructor() {
    super("Solodot run was not found for the authenticated principal.");
    this.name = "RunNotFoundError";
  }
}

export class AssetNotFoundError extends Error {
  constructor() {
    super("Execution asset was not found in this Solodot run.");
    this.name = "AssetNotFoundError";
  }
}

export class InMemoryExecutionRepository implements ExecutionRepository {
  readonly durable = false;
  private readonly records = new Map<string, SolodotRunRecord>();

  async saveDiagnostic(
    principal: string,
    intake: DiagnosticIntake,
    diagnostic: DiagnosticResult,
  ) {
    this.records.set(key(principal, diagnostic.runId), {
      intake,
      diagnostic,
      assets: [],
      approvals: [],
    });
  }

  async getRun(principal: string, runId: string) {
    const record = this.records.get(key(principal, runId));
    if (!record) throw new RunNotFoundError();
    return structuredClone(record);
  }

  async saveAsset(principal: string, asset: ExecutionAsset) {
    const record = this.records.get(key(principal, asset.runId));
    if (!record) throw new RunNotFoundError();
    record.assets.push(structuredClone(asset));
  }

  async reviewAsset(
    principal: string,
    runId: string,
    assetId: string,
    decision: ApprovalDecision,
    reason: string,
  ) {
    const record = this.records.get(key(principal, runId));
    if (!record) throw new RunNotFoundError();
    const asset = record.assets.find((candidate) => candidate.assetId === assetId);
    if (!asset) throw new AssetNotFoundError();
    asset.status = decisionToStatus(decision);
    record.approvals.push({
      assetId,
      decision,
      reason,
      createdAt: new Date().toISOString(),
    });
    return structuredClone(asset);
  }
}

export class SupabaseExecutionRepository implements ExecutionRepository {
  readonly durable = true;

  constructor() {
    if (!getRunPersistenceConfig()) {
      throw new Error(
        "Supabase execution repository requires service credentials plus SOLODOT_MCP_WORKSPACE_ID and SOLODOT_MCP_USER_ID.",
      );
    }
  }

  async saveDiagnostic(
    principal: string,
    intake: DiagnosticIntake,
    diagnostic: DiagnosticResult,
  ) {
    const outcome = await tryPersistDiagnosticRun({
      intake,
      result: diagnostic,
    });
    if (outcome.status !== "stored") {
      throw new Error(outcome.message || "Diagnostic run could not be stored.");
    }
  }

  async getRun(principal: string, runId: string) {
    try {
      const snapshot = await getPersistedRunSnapshot({
        runId,
      });
      const run = snapshot.run;
      const diagnostic = run.diagnostic_result as DiagnosticResult;
      const intakeBrief = run.intake_brief as DiagnosticIntake;
      const assets = snapshot.artifacts
        .map((artifact) => artifact.payload)
        .filter(isExecutionAsset);
      const approvals = snapshot.approvals.map((approval) => ({
        assetId: String(approval.action_id || ""),
        decision: normalizeDecision(approval.decision),
        reason: String(approval.reason || ""),
        createdAt: String(approval.created_at || ""),
      }));

      return {
        intake: intakeBrief,
        diagnostic,
        assets: applyStoredStatuses(assets, snapshot.actions),
        approvals,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        throw new RunNotFoundError();
      }
      throw error;
    }
  }

  async saveAsset(principal: string, asset: ExecutionAsset) {
    await persistExecutionAsset({ asset });
  }

  async reviewAsset(
    principal: string,
    runId: string,
    assetId: string,
    decision: ApprovalDecision,
    reason: string,
  ) {
    await recordApproval({
      runId,
      actionId: assetId,
      decision,
      reason,
    });
    const record = await this.getRun(principal, runId);
    const asset = record.assets.find((candidate) => candidate.assetId === assetId);
    if (!asset) throw new AssetNotFoundError();
    return asset;
  }
}

function key(principal: string, runId: string) {
  return `${principal}\u001f${runId}`;
}

function decisionToStatus(decision: ApprovalDecision): ExecutionAssetStatus {
  if (decision === "approve") return "approved";
  if (decision === "revise") return "revision_requested";
  return "rejected";
}

function isExecutionAsset(value: unknown): value is ExecutionAsset {
  return Boolean(
    value &&
      typeof value === "object" &&
      "assetId" in value &&
      "workflowKey" in value &&
      "content" in value,
  );
}

function normalizeDecision(value: unknown): ApprovalDecision {
  if (value === "approve" || value === "reject") return value;
  return "revise";
}

function applyStoredStatuses(
  assets: ExecutionAsset[],
  actions: Record<string, unknown>[],
) {
  const statuses = new Map(
    actions.map((action) => [String(action.id), String(action.status)]),
  );
  return assets.map((asset) => ({
    ...asset,
    status: normalizeStatus(statuses.get(asset.assetId)),
  }));
}

function normalizeStatus(value: unknown): ExecutionAssetStatus {
  if (
    value === "approved" ||
    value === "revision_requested" ||
    value === "rejected"
  ) {
    return value;
  }
  return "proposed";
}
