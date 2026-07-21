import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ConnectionStatus,
  OpenAIAuthMode,
} from "./connectionSelection";
import type { ModelAlias } from "./modelRouting";
import type { ExecutionAsset } from "../harness/types";

export type RuntimeJob = {
  id: string;
  workspace_id: string;
  run_id: string;
  workflow_key: string;
  status: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_by: string;
};

export type RuntimeConnection = {
  id: string;
  workspace_id: string;
  auth_mode: OpenAIAuthMode;
  status: ConnectionStatus;
  secret_ref: string | null;
  expires_at: string | null;
};

export type PendingAuthAttempt = {
  id: string;
  workspace_id: string;
  connection_id: string;
  device_auth_id: string | null;
  user_code: string | null;
  poll_interval_seconds: number;
  expires_at: string;
  runtime_id: string;
  lease_expires_at: string;
};

export type RuntimeTokenDeletion = {
  connection_id: string;
};

export class RuntimeRepository {
  constructor(private readonly client: Pick<SupabaseClient, "rpc" | "from">) {}

  async claimJobs(runtimeId: string, limit: number, leaseSeconds: number) {
    const { data, error } = await this.client.rpc("claim_solodot_agent_jobs", {
      p_runtime_id: runtimeId,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    });
    if (error) throw error;
    return (data || []) as RuntimeJob[];
  }

  async renewLease(jobId: string, runtimeId: string, leaseSeconds: number) {
    const { data, error } = await this.client.rpc(
      "renew_solodot_agent_job_lease",
      {
        p_job_id: jobId,
        p_runtime_id: runtimeId,
        p_lease_seconds: leaseSeconds,
      },
    );
    if (error) throw error;
    return data === true;
  }

  async claimAuthAttempts(runtimeId: string, limit: number, leaseSeconds: number) {
    const { data, error } = await this.client.rpc(
      "claim_solodot_openai_auth_attempts",
      {
        p_runtime_id: runtimeId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      },
    );
    if (error) throw error;
    return (data || []) as PendingAuthAttempt[];
  }

  async renewAuthAttemptLease(
    attemptId: string,
    runtimeId: string,
    leaseSeconds: number,
  ) {
    const { data, error } = await this.client.rpc(
      "renew_solodot_openai_auth_attempt_lease",
      {
        p_attempt_id: attemptId,
        p_runtime_id: runtimeId,
        p_lease_seconds: leaseSeconds,
      },
    );
    if (error) throw error;
    return data === true;
  }

  async heartbeat({
    runtimeId,
    version,
    status,
    activeJobCount,
    capacity,
  }: {
    runtimeId: string;
    version: string;
    status: "starting" | "healthy" | "draining" | "stopped" | "error";
    activeJobCount: number;
    capacity: number;
  }) {
    const { error } = await this.client.from("solodot_runtime_heartbeats").upsert({
      runtime_id: runtimeId,
      version,
      status,
      active_job_count: activeJobCount,
      capacity,
      last_seen_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async getWorkspaceConnections(workspaceId: string) {
    const [workspaceResult, connectionsResult] = await Promise.all([
      this.client
        .from("workspaces")
        .select("preferred_openai_auth_mode")
        .eq("id", workspaceId)
        .single(),
      this.client
        .from("solodot_openai_connections")
        .select("*")
        .eq("workspace_id", workspaceId),
    ]);
    if (workspaceResult.error) throw workspaceResult.error;
    if (connectionsResult.error) throw connectionsResult.error;
    return {
      preferredMode:
        (workspaceResult.data.preferred_openai_auth_mode as OpenAIAuthMode | null) ||
        null,
      connections: connectionsResult.data as RuntimeConnection[],
    };
  }

  async readApiKey(connectionId: string) {
    const { data, error } = await this.client.rpc(
      "get_solodot_openai_api_key_for_runtime",
      { p_connection_id: connectionId },
    );
    if (error) throw error;
    if (typeof data !== "string" || !data) throw new Error("Vault API key is unavailable.");
    return data;
  }

  async updateConnection(
    connectionId: string,
    patch: Record<string, unknown>,
  ) {
    const { error } = await this.client
      .from("solodot_openai_connections")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", connectionId);
    if (error) throw error;
  }

  async listPendingAuthAttempts(limit = 8) {
    const { data, error } = await this.client
      .from("solodot_openai_auth_attempts")
      .select("*")
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at")
      .limit(limit);
    if (error) throw error;
    return (data || []) as PendingAuthAttempt[];
  }

  async updateAuthAttempt(attemptId: string, patch: Record<string, unknown>) {
    const { error } = await this.client
      .from("solodot_openai_auth_attempts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", attemptId);
    if (error) throw error;
  }

  async getAuthAttemptStatus(attemptId: string) {
    const { data, error } = await this.client
      .from("solodot_openai_auth_attempts")
      .select("status")
      .eq("id", attemptId)
      .maybeSingle();
    if (error) throw error;
    return typeof data?.status === "string" ? data.status : null;
  }

  async expirePendingAuthAttempts(now = new Date().toISOString()) {
    const { error } = await this.client
      .from("solodot_openai_auth_attempts")
      .update({ status: "expired", updated_at: now })
      .in("status", ["queued", "starting", "pending"])
      .lt("expires_at", now);
    if (error) throw error;
  }

  async listTokenDeletionRequests(limit = 32) {
    const { data, error } = await this.client
      .from("solodot_runtime_token_deletions")
      .select("connection_id")
      .order("requested_at")
      .limit(limit);
    if (error) throw error;
    return (data || []) as RuntimeTokenDeletion[];
  }

  async completeTokenDeletion(connectionId: string) {
    const { error } = await this.client
      .from("solodot_runtime_token_deletions")
      .delete()
      .eq("connection_id", connectionId);
    if (error) throw error;
  }

  async createStep({
    job,
    role,
    modelAlias,
    resolvedModel,
    authMode,
    routingReason,
    input,
  }: {
    job: RuntimeJob;
    role: string;
    modelAlias: ModelAlias;
    resolvedModel: string;
    authMode: OpenAIAuthMode;
    routingReason: string;
    input: unknown;
  }) {
    const { data, error } = await this.client
      .from("solodot_agent_steps")
      .insert({
        workspace_id: job.workspace_id,
        run_id: job.run_id,
        job_id: job.id,
        role,
        status: "running",
        model_alias: modelAlias,
        resolved_model: resolvedModel,
        openai_auth_mode: authMode,
        routing_reason: routingReason,
        input,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return String(data.id);
  }

  async completeStep(stepId: string, output: unknown) {
    const { error } = await this.client
      .from("solodot_agent_steps")
      .update({ status: "completed", output, completed_at: new Date().toISOString() })
      .eq("id", stepId);
    if (error) throw error;
  }

  async failStep(stepId: string, errorMessage: string) {
    const { error } = await this.client
      .from("solodot_agent_steps")
      .update({
        status: "failed",
        output: { error: errorMessage },
        completed_at: new Date().toISOString(),
      })
      .eq("id", stepId);
    if (error) throw error;
  }

  async pauseForProviderApproval(job: RuntimeJob, fallbackMode: OpenAIAuthMode) {
    const now = new Date().toISOString();
    const { error: jobError } = await this.client
      .from("solodot_agent_jobs")
      .update({
        status: "waiting_for_provider_approval",
        lease_owner: null,
        lease_expires_at: null,
        payload: { ...job.payload, proposedFallbackMode: fallbackMode },
        updated_at: now,
      })
      .eq("id", job.id);
    if (jobError) throw jobError;
    const { error: runError } = await this.client
      .from("solodot_agent_runs")
      .update({ status: "waiting_for_provider_approval", updated_at: now })
      .eq("id", job.run_id);
    if (runError) throw runError;
  }

  async markJobRunning(job: RuntimeJob) {
    const now = new Date().toISOString();
    const { error: jobError } = await this.client
      .from("solodot_agent_jobs")
      .update({ status: "running", updated_at: now })
      .eq("id", job.id)
      .eq("lease_owner", job.lease_owner);
    if (jobError) throw jobError;
    const { error: runError } = await this.client
      .from("solodot_agent_runs")
      .update({ status: "running", updated_at: now })
      .eq("id", job.run_id);
    if (runError) throw runError;
  }

  async completeJob(job: RuntimeJob, result: unknown) {
    const now = new Date().toISOString();
    const { error: jobError } = await this.client
      .from("solodot_agent_jobs")
      .update({
        status: "completed",
        result,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: now,
      })
      .eq("id", job.id);
    if (jobError) throw jobError;
    const { error: runError } = await this.client
      .from("solodot_agent_runs")
      .update({ status: "awaiting_founder_approval", updated_at: now })
      .eq("id", job.run_id);
    if (runError) throw runError;
  }

  async saveExecutionAsset(job: RuntimeJob, asset: ExecutionAsset) {
    const action = {
      id: asset.assetId,
      workspace_id: job.workspace_id,
      created_by: job.created_by,
      run_id: job.run_id,
      title: asset.title,
      workflow_key: asset.workflowKey,
      action_type: "draft",
      status: "proposed",
      preview_payload: asset.content,
      risk_level: asset.risks.length > 2 ? "medium" : "low",
      approval_required: true,
      unsupported_claims: asset.unsupportedClaims,
      copy_export_output: asset.content,
      verification_status: "not_started",
    };
    const artifact = {
      id: asset.assetId,
      workspace_id: job.workspace_id,
      created_by: job.created_by,
      run_id: job.run_id,
      artifact_type: asset.artifactType,
      title: asset.title,
      content: asset.content,
      payload: asset,
    };
    const [actionResult, artifactResult] = await Promise.all([
      this.client.from("solodot_recommended_actions").upsert(action),
      this.client.from("solodot_artifacts").upsert(artifact),
    ]);
    if (actionResult.error) throw actionResult.error;
    if (artifactResult.error) throw artifactResult.error;
  }

  async failJob(job: RuntimeJob, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const retry = job.attempt_count < job.max_attempts;
    const { error: updateError } = await this.client
      .from("solodot_agent_jobs")
      .update({
        status: retry ? "queued" : "failed",
        available_at: new Date(Date.now() + Math.min(60_000, 2 ** job.attempt_count * 1_000)).toISOString(),
        lease_owner: null,
        lease_expires_at: null,
        last_error_code: error instanceof Error ? error.name : "RUNTIME_ERROR",
        last_error_message: message.slice(0, 1200),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    if (updateError) throw updateError;
    if (!retry) {
      const { error: runError } = await this.client
        .from("solodot_agent_runs")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", job.run_id);
      if (runError) throw runError;
    }
  }
}

export function createRuntimeRepositoryFromEnv() {
  const { url, serviceKey } = resolveRuntimeSupabaseConfig(process.env);
  return new RuntimeRepository(
    createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  );
}

export function resolveRuntimeSupabaseConfig(
  environment: Record<string, string | undefined>,
) {
  const url = (
    environment.SUPABASE_URL || environment.NEXT_PUBLIC_SUPABASE_URL
  )?.trim();
  const serviceKey = (
    environment.SUPABASE_SECRET_KEY ||
    environment.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!url || !serviceKey) {
    throw new Error(
      "Runtime requires SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  return { url, serviceKey };
}
