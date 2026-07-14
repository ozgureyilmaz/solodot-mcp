import { describe, expect, it, vi } from "vitest";
import { RuntimeRepository } from "../src/runtime/repository";

describe("RuntimeRepository leases", () => {
  it("claims bounded jobs through the atomic SKIP LOCKED RPC", async () => {
    const rpc = vi.fn(async () => ({ data: [{ id: "job-1" }], error: null }));
    const repository = new RuntimeRepository({ rpc } as never);
    await expect(repository.claimJobs("runtime-1", 8, 120)).resolves.toEqual([
      { id: "job-1" },
    ]);
    expect(rpc).toHaveBeenCalledWith("claim_solodot_agent_jobs", {
      p_runtime_id: "runtime-1",
      p_limit: 8,
      p_lease_seconds: 120,
    });
  });

  it("renews a lease only through the owning-runtime RPC", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const repository = new RuntimeRepository({ rpc } as never);
    await expect(
      repository.renewLease("job-1", "runtime-1", 120),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("renew_solodot_agent_job_lease", {
      p_job_id: "job-1",
      p_runtime_id: "runtime-1",
      p_lease_seconds: 120,
    });
  });

  it("lists pending encrypted-token deletions for the runtime", async () => {
    const limit = vi.fn(async () => ({
      data: [{ connection_id: "connection-1" }],
      error: null,
    }));
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    const repository = new RuntimeRepository({ from } as never);

    await expect(repository.listTokenDeletionRequests(12)).resolves.toEqual([
      { connection_id: "connection-1" },
    ]);
    expect(from).toHaveBeenCalledWith("solodot_runtime_token_deletions");
    expect(select).toHaveBeenCalledWith("connection_id");
    expect(limit).toHaveBeenCalledWith(12);
  });

  it("acknowledges a token deletion only after disk cleanup", async () => {
    const eq = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ delete: remove }));
    const repository = new RuntimeRepository({ from } as never);

    await expect(
      repository.completeTokenDeletion("connection-1"),
    ).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith("solodot_runtime_token_deletions");
    expect(eq).toHaveBeenCalledWith("connection_id", "connection-1");
  });

  it("expires stale pending device authorization attempts", async () => {
    const lt = vi.fn(async () => ({ error: null }));
    const eq = vi.fn(() => ({ lt }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const repository = new RuntimeRepository({ from } as never);

    await expect(
      repository.expirePendingAuthAttempts("2026-07-14T10:00:00.000Z"),
    ).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith("solodot_openai_auth_attempts");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "expired" }),
    );
    expect(eq).toHaveBeenCalledWith("status", "pending");
    expect(lt).toHaveBeenCalledWith(
      "expires_at",
      "2026-07-14T10:00:00.000Z",
    );
  });
});
