import type { DiagnosticResult } from "../harness/types";
import { CodexAuthenticationError } from "./codexOAuth";
import { CodexUsageLimitError } from "./codexResponses";
import { selectOpenAIConnection, type OpenAIAuthMode } from "./connectionSelection";
import { RuntimeOpenAIGateway } from "./gateway";
import { runAdaptiveExecution } from "./orchestration";
import {
  RuntimeRepository,
  type RuntimeConnection,
  type RuntimeJob,
} from "./repository";
import { EncryptedTokenStore } from "./tokenStore";

export class RuntimeJobProcessor {
  constructor(
    private readonly repository: RuntimeRepository,
    private readonly tokenStore: EncryptedTokenStore,
    private readonly maxWorkers: number,
  ) {}

  async process(job: RuntimeJob) {
    let connection: RuntimeConnection | undefined;
    try {
      await this.repository.markJobRunning(job);
      const context = await this.repository.getWorkspaceConnections(job.workspace_id);
      const approvedFallback = readApprovedFallback(job.payload);
      const decision = approvedFallback
        ? approvedFallbackDecision(approvedFallback, context.connections)
        : selectOpenAIConnection({
            preferredMode: context.preferredMode,
            connections: context.connections.map((candidate) => ({
              mode: candidate.auth_mode,
              status: candidate.status,
            })),
          });

      if (decision.state === "approval_required" && decision.fallbackMode) {
        await this.repository.pauseForProviderApproval(job, decision.fallbackMode);
        return { status: "waiting_for_provider_approval" as const };
      }
      if (decision.state !== "ready" || !decision.selectedMode) {
        throw new Error("No healthy OpenAI connection is available for this workspace.");
      }
      connection = context.connections.find(
        (candidate) => candidate.auth_mode === decision.selectedMode,
      );
      if (!connection) throw new Error("Selected OpenAI connection is unavailable.");

      const diagnostic = readDiagnostic(job.payload);
      const routingReason =
        diagnostic.routing?.reason || "Runtime selected the efficient harness from the execution pack.";
      const gateway = new RuntimeOpenAIGateway(
        this.repository,
        this.tokenStore,
        job,
        connection,
        routingReason,
      );
      const result = await runAdaptiveExecution({
        diagnostic,
        workflowKey: job.workflow_key,
        gateway,
        maxWorkers: this.maxWorkers,
      });
      await this.repository.saveExecutionAsset(job, result.asset);
      await this.repository.completeJob(job, {
        ...result,
        openaiAuthMode: connection.auth_mode,
      });
      return { status: "completed" as const, result };
    } catch (error) {
      const subscriptionStatus =
        error instanceof CodexUsageLimitError
          ? "rate_limited"
          : error instanceof CodexAuthenticationError
            ? "revoked"
            : null;
      if (subscriptionStatus && connection?.auth_mode === "codex_subscription") {
        await this.repository.updateConnection(connection.id, {
          status: subscriptionStatus,
          last_error_code:
            error instanceof Error ? error.name : "CODEX_SUBSCRIPTION_ERROR",
          last_error_message:
            error instanceof Error
              ? error.message.slice(0, 500)
              : String(error).slice(0, 500),
          last_checked_at: new Date().toISOString(),
        });
        const context = await this.repository.getWorkspaceConnections(job.workspace_id);
        const apiKeyReady = context.connections.some(
          (candidate) => candidate.auth_mode === "api_key" && candidate.status === "connected",
        );
        if (apiKeyReady) {
          await this.repository.pauseForProviderApproval(job, "api_key");
          return { status: "waiting_for_provider_approval" as const };
        }
      }
      await this.repository.failJob(job, error);
      return { status: "failed" as const, error };
    }
  }
}

function readDiagnostic(payload: Record<string, unknown>) {
  const diagnostic = payload.diagnostic;
  if (!diagnostic || typeof diagnostic !== "object" || !("runId" in diagnostic)) {
    throw new Error("Runtime job is missing its diagnostic context.");
  }
  return diagnostic as DiagnosticResult;
}

function readApprovedFallback(payload: Record<string, unknown>) {
  return payload.approvedFallbackMode === "api_key" ||
    payload.approvedFallbackMode === "codex_subscription"
    ? payload.approvedFallbackMode
    : null;
}

function approvedFallbackDecision(
  mode: OpenAIAuthMode,
  connections: RuntimeConnection[],
) {
  const healthy = connections.some(
    (connection) => connection.auth_mode === mode && connection.status === "connected",
  );
  return healthy
    ? { state: "ready" as const, selectedMode: mode, fallbackMode: null }
    : { state: "connection_required" as const, selectedMode: null, fallbackMode: null };
}
