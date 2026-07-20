import { describe, expect, it, vi } from "vitest";
import { CodexAuthenticationError } from "../src/runtime/codexAppServer";
import { RuntimeJobProcessor } from "../src/runtime/processor";
import { diagnostic } from "./fixtures";

describe("RuntimeJobProcessor subscription recovery", () => {
  it("pauses for founder approval when revoked subscription credentials have an API fallback", async () => {
    const subscription = {
      id: "subscription-1",
      workspace_id: "workspace-1",
      auth_mode: "codex_subscription",
      status: "connected",
      secret_ref: "runtime:subscription-1",
      expires_at: "2026-07-14T09:00:00.000Z",
    } as const;
    const apiKey = {
      id: "api-key-1",
      workspace_id: "workspace-1",
      auth_mode: "api_key",
      status: "connected",
      secret_ref: "vault-secret",
      expires_at: null,
    } as const;
    const repository = {
      markJobRunning: vi.fn(async () => undefined),
      getWorkspaceConnections: vi.fn(async () => ({
        preferredMode: "codex_subscription",
        connections: [subscription, apiKey],
      })),
      createStep: vi.fn(async () => "step-1"),
      failStep: vi.fn(async () => undefined),
      updateConnection: vi.fn(async () => undefined),
      pauseForProviderApproval: vi.fn(async () => undefined),
      failJob: vi.fn(async () => undefined),
    };
    const job = {
      id: "job-1",
      workspace_id: "workspace-1",
      run_id: "diag_test_001",
      workflow_key: "bottleneck_map",
      status: "routing",
      payload: { diagnostic: diagnostic("bottleneck_map") },
      attempt_count: 1,
      max_attempts: 3,
      lease_owner: "runtime-1",
      lease_expires_at: "2026-07-14T11:00:00.000Z",
      created_by: "user-1",
    };

    const processor = new RuntimeJobProcessor(
      repository as never,
      {} as never,
      8,
      () => ({
        call: vi.fn(async () => {
          throw new CodexAuthenticationError("ChatGPT login was revoked.");
        }),
        connection: subscription,
      }) as never,
    );

    await expect(processor.process(job)).resolves.toEqual({
      status: "waiting_for_provider_approval",
    });
    expect(repository.updateConnection).toHaveBeenCalledWith(
      "subscription-1",
      expect.objectContaining({ status: "revoked" }),
    );
    expect(repository.pauseForProviderApproval).toHaveBeenCalledWith(
      job,
      "api_key",
    );
    expect(repository.failJob).not.toHaveBeenCalled();
  });
});
