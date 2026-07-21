import { describe, expect, it, vi } from "vitest";
import { RuntimeOpenAIGateway } from "../src/runtime/gateway";

describe("managed Codex gateway", () => {
  it("serializes auth-cache use for the same subscription connection", async () => {
    let releaseFirst!: () => void;
    const firstTurn = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let clientsCreated = 0;
    const repository = {
      createStep: vi.fn(async () => `step-${repository.createStep.mock.calls.length}`),
      completeStep: vi.fn(async () => undefined),
      failStep: vi.fn(async () => undefined),
      updateConnection: vi.fn(async () => undefined),
    };
    const homeManager = {
      open: vi.fn(async () => ({
        path: "/tmp/codex-home",
        workspacePath: "/tmp/codex-workspace",
        persistAndDiscard: vi.fn(async () => undefined),
        discard: vi.fn(async () => undefined),
      })),
    };
    const createClient = () => {
      clientsCreated += 1;
      const clientNumber = clientsCreated;
      return {
        initialize: vi.fn(async () => undefined),
        readAccount: vi.fn(async () => ({
          account: { type: "chatgpt", email: "founder@example.com" },
        })),
        runStructured: vi.fn(async () => {
          if (clientNumber === 1) await firstTurn;
          return { value: `result-${clientNumber}` };
        }),
        close: vi.fn(async () => undefined),
      };
    };
    const connection = {
      id: "connection-1",
      workspace_id: "workspace-1",
      auth_mode: "codex_subscription",
      status: "connected",
      secret_ref: "runtime:connection-1",
      expires_at: null,
    } as const;
    const job = {
      id: "job-1",
      workspace_id: "workspace-1",
      run_id: "run-1",
      workflow_key: "bottleneck_map",
      status: "running",
      payload: {},
      attempt_count: 1,
      max_attempts: 3,
      lease_owner: "runtime-1",
      lease_expires_at: null,
      created_by: "user-1",
    };
    const firstGateway = new RuntimeOpenAIGateway(
      repository as never,
      homeManager as never,
      job,
      connection,
      "test",
      createClient as never,
    );
    const secondGateway = new RuntimeOpenAIGateway(
      repository as never,
      homeManager as never,
      job,
      connection,
      "test",
      createClient as never,
    );
    const input = {
      role: "synthesizer" as const,
      system: "System",
      user: "User",
      schema: { type: "object" as const, properties: { value: { type: "string" as const } } },
      outputName: "result",
      outputDescription: "Result",
    };

    const first = firstGateway.call(input);
    await vi.waitFor(() => expect(clientsCreated).toBe(1));
    const second = secondGateway.call(input);
    await vi.waitFor(() =>
      expect(repository.createStep).toHaveBeenCalledTimes(2),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(clientsCreated).toBe(1);

    releaseFirst();
    await expect(first).resolves.toEqual({ value: "result-1" });
    await expect(second).resolves.toEqual({ value: "result-2" });
    expect(clientsCreated).toBe(2);
  });
});
