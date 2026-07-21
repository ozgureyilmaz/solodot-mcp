import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { DeviceAuthWorker } from "../src/runtime/authWorker";
import { encryptCodexCredential } from "../src/runtime/credentialTransfer";

const attempt = {
  id: "attempt-1",
  workspace_id: "workspace-1",
  connection_id: "connection-1",
  device_auth_id: null,
  user_code: null,
  poll_interval_seconds: 2,
  expires_at: "2099-07-20T10:15:00.000Z",
  runtime_id: "runtime-1",
  lease_expires_at: "2099-07-20T10:01:00.000Z",
  credential_envelope: null,
  account_label: null,
};

describe("DeviceAuthWorker official app-server flow", () => {
  it("imports an end-to-end encrypted companion credential without starting app-server", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("x25519");
    const importedAttempt = {
      ...attempt,
      credential_envelope: encryptCodexCredential({
        authJson: '{"tokens":{"access_token":"secret"}}',
        publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
        attemptId: attempt.id,
      }),
      account_label: "member@example.com · plus",
    };
    const repository = {
      expirePendingAuthAttempts: vi.fn(async () => undefined),
      listTokenDeletionRequests: vi.fn(async () => []),
      claimAuthAttempts: vi.fn(async () => [importedAttempt]),
      updateAuthAttempt: vi.fn(async () => undefined),
      updateConnection: vi.fn(async () => undefined),
    };
    const tokenStore = {
      save: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const createClient = vi.fn();
    const homeManager = { open: vi.fn() };
    const worker = new DeviceAuthWorker({
      repository: repository as never,
      tokenStore: tokenStore as never,
      homeManager: homeManager as never,
      runtimeId: "runtime-1",
      transferPrivateKey: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      createClient,
    });

    await worker.tick();
    await worker.drain();

    expect(createClient).not.toHaveBeenCalled();
    expect(homeManager.open).not.toHaveBeenCalled();
    expect(tokenStore.save).toHaveBeenCalledWith("connection-1", {
      authJson: '{"tokens":{"access_token":"secret"}}',
    });
    expect(repository.updateConnection).toHaveBeenCalledWith(
      "connection-1",
      expect.objectContaining({
        status: "connected",
        account_label: "member@example.com · plus",
      }),
    );
    expect(repository.updateAuthAttempt).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({
        status: "authorized",
        credential_envelope: null,
      }),
    );
  });

  it("removes an unusable transfer envelope when runtime import fails", async () => {
    const { publicKey } = generateKeyPairSync("x25519");
    const importedAttempt = {
      ...attempt,
      credential_envelope: encryptCodexCredential({
        authJson: '{"tokens":{"access_token":"secret"}}',
        publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
        attemptId: attempt.id,
      }),
      account_label: "member@example.com · plus",
    };
    const repository = {
      expirePendingAuthAttempts: vi.fn(async () => undefined),
      listTokenDeletionRequests: vi.fn(async () => []),
      claimAuthAttempts: vi.fn(async () => [importedAttempt]),
      updateAuthAttempt: vi.fn(async () => undefined),
      updateConnection: vi.fn(async () => undefined),
      getAuthAttemptStatus: vi.fn(async () => "starting"),
    };
    const worker = new DeviceAuthWorker({
      repository: repository as never,
      tokenStore: { delete: vi.fn() } as never,
      homeManager: { open: vi.fn() } as never,
      runtimeId: "runtime-1",
      transferPrivateKey: "not-a-private-key",
    });

    await worker.tick();
    await worker.drain();

    expect(repository.updateAuthAttempt).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({
        status: "error",
        credential_envelope: null,
        account_label: null,
      }),
    );
  });

  it("persists only the encrypted managed cache after ChatGPT login", async () => {
    const repository = {
      expirePendingAuthAttempts: vi.fn(async () => undefined),
      listTokenDeletionRequests: vi.fn(async () => []),
      claimAuthAttempts: vi.fn(async () => [attempt]),
      updateAuthAttempt: vi.fn(async () => undefined),
      updateConnection: vi.fn(async () => undefined),
      renewAuthAttemptLease: vi.fn(async () => true),
      getAuthAttemptStatus: vi.fn(async () => "pending"),
    };
    const tokenStore = { delete: vi.fn(async () => undefined) };
    const home = {
      path: "/tmp/codex-home",
      persistAndDiscard: vi.fn(async () => undefined),
      discard: vi.fn(async () => undefined),
    };
    const homeManager = { open: vi.fn(async () => home) };
    const client = {
      initialize: vi.fn(async () => undefined),
      startChatGPTDeviceLogin: vi.fn(async () => ({
        loginId: "login-1",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-1234",
      })),
      waitForLogin: vi.fn(async () => undefined),
      readAccount: vi.fn(async () => ({
        account: { type: "chatgpt", email: "user@example.com", planType: "plus" },
      })),
      cancelLogin: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const worker = new DeviceAuthWorker({
      repository: repository as never,
      tokenStore: tokenStore as never,
      homeManager: homeManager as never,
      runtimeId: "runtime-1",
      createClient: () => client as never,
      statusPollMilliseconds: 1,
    });

    await worker.tick();
    await worker.drain();

    expect(repository.updateAuthAttempt).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({
        status: "pending",
        device_auth_id: "login-1",
        user_code: "ABCD-1234",
      }),
    );
    expect(home.persistAndDiscard).toHaveBeenCalledOnce();
    expect(repository.updateConnection).toHaveBeenCalledWith(
      "connection-1",
      expect.objectContaining({
        status: "connected",
        secret_ref: "runtime:connection-1",
        account_label: "user@example.com · plus",
      }),
    );
    expect(repository.updateAuthAttempt).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({
        status: "authorized",
        device_auth_id: null,
        user_code: null,
      }),
    );
  });

  it("uses browser OAuth only when the runtime explicitly selects local browser mode", async () => {
    const repository = {
      expirePendingAuthAttempts: vi.fn(async () => undefined),
      listTokenDeletionRequests: vi.fn(async () => []),
      claimAuthAttempts: vi.fn(async () => [attempt]),
      updateAuthAttempt: vi.fn(async () => undefined),
      updateConnection: vi.fn(async () => undefined),
      renewAuthAttemptLease: vi.fn(async () => true),
      getAuthAttemptStatus: vi.fn(async () => "pending"),
    };
    const home = {
      path: "/tmp/codex-home",
      persistAndDiscard: vi.fn(async () => undefined),
      discard: vi.fn(async () => undefined),
    };
    const client = {
      initialize: vi.fn(async () => undefined),
      startChatGPTDeviceLogin: vi.fn(),
      startChatGPTBrowserLogin: vi.fn(async () => ({
        loginId: "login-browser-1",
        authUrl: "https://auth.openai.com/oauth/authorize",
      })),
      waitForLogin: vi.fn(async () => undefined),
      readAccount: vi.fn(async () => ({
        account: { type: "chatgpt", email: "user@example.com", planType: "plus" },
      })),
      cancelLogin: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const worker = new DeviceAuthWorker({
      repository: repository as never,
      tokenStore: { delete: vi.fn() } as never,
      homeManager: { open: vi.fn(async () => home) } as never,
      runtimeId: "runtime-1",
      loginMode: "browser",
      createClient: () => client as never,
      statusPollMilliseconds: 1,
    });

    await worker.tick();
    await worker.drain();

    expect(client.startChatGPTBrowserLogin).toHaveBeenCalledOnce();
    expect(client.startChatGPTDeviceLogin).not.toHaveBeenCalled();
    expect(repository.updateAuthAttempt).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({
        status: "pending",
        device_auth_id: "login-browser-1",
        user_code: null,
        verification_uri: "https://auth.openai.com/oauth/authorize",
      }),
    );
  });

  it("cancels app-server login when the owning user cancels the attempt", async () => {
    let completeLogin: (() => void) | undefined;
    const repository = {
      expirePendingAuthAttempts: vi.fn(async () => undefined),
      listTokenDeletionRequests: vi.fn(async () => []),
      claimAuthAttempts: vi.fn(async () => [attempt]),
      updateAuthAttempt: vi.fn(async () => undefined),
      updateConnection: vi.fn(async () => undefined),
      renewAuthAttemptLease: vi.fn(async () => true),
      getAuthAttemptStatus: vi.fn(async () => "cancelled"),
    };
    const home = {
      path: "/tmp/codex-home",
      persistAndDiscard: vi.fn(async () => undefined),
      discard: vi.fn(async () => undefined),
    };
    const client = {
      initialize: vi.fn(async () => undefined),
      startChatGPTDeviceLogin: vi.fn(async () => ({
        loginId: "login-1",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-1234",
      })),
      waitForLogin: vi.fn(
        () => new Promise<void>((resolve) => { completeLogin = resolve; }),
      ),
      readAccount: vi.fn(),
      cancelLogin: vi.fn(async () => { completeLogin?.(); }),
      close: vi.fn(async () => undefined),
    };
    const worker = new DeviceAuthWorker({
      repository: repository as never,
      tokenStore: { delete: vi.fn() } as never,
      homeManager: { open: vi.fn(async () => home) } as never,
      runtimeId: "runtime-1",
      createClient: () => client as never,
      statusPollMilliseconds: 1,
    });

    await worker.tick();
    await worker.drain();

    expect(client.cancelLogin).toHaveBeenCalledWith("login-1");
    expect(home.persistAndDiscard).not.toHaveBeenCalled();
    expect(home.discard).toHaveBeenCalledOnce();
    expect(repository.updateConnection).not.toHaveBeenCalledWith(
      "connection-1",
      expect.objectContaining({ status: "connected" }),
    );
  });

  it("marks the attempt failed when the private auth home cannot be opened", async () => {
    const repository = {
      expirePendingAuthAttempts: vi.fn(async () => undefined),
      listTokenDeletionRequests: vi.fn(async () => []),
      claimAuthAttempts: vi.fn(async () => [attempt]),
      updateAuthAttempt: vi.fn(async () => undefined),
      updateConnection: vi.fn(async () => undefined),
      getAuthAttemptStatus: vi.fn(async () => "starting"),
    };
    const worker = new DeviceAuthWorker({
      repository: repository as never,
      tokenStore: { delete: vi.fn() } as never,
      homeManager: {
        open: vi.fn(async () => {
          throw new Error("Encrypted cache could not be opened.");
        }),
      } as never,
      runtimeId: "runtime-1",
      createClient: vi.fn() as never,
    });

    await worker.tick();
    await worker.drain();

    expect(repository.updateAuthAttempt).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({ status: "error" }),
    );
    expect(repository.updateConnection).toHaveBeenCalledWith(
      "connection-1",
      expect.objectContaining({
        status: "error",
        last_error_message: "Encrypted cache could not be opened.",
      }),
    );
  });

  it("cancels an active app-server login while draining", async () => {
    let allowRepositoryCancellation = false;
    let completeLogin: (() => void) | undefined;
    const repository = {
      expirePendingAuthAttempts: vi.fn(async () => undefined),
      listTokenDeletionRequests: vi.fn(async () => []),
      claimAuthAttempts: vi.fn(async () => [attempt]),
      updateAuthAttempt: vi.fn(async () => undefined),
      updateConnection: vi.fn(async () => undefined),
      renewAuthAttemptLease: vi.fn(async () => true),
      getAuthAttemptStatus: vi.fn(async () =>
        allowRepositoryCancellation ? "cancelled" : "pending",
      ),
    };
    const home = {
      path: "/tmp/codex-home",
      persistAndDiscard: vi.fn(async () => undefined),
      discard: vi.fn(async () => undefined),
    };
    const client = {
      initialize: vi.fn(async () => undefined),
      startChatGPTDeviceLogin: vi.fn(async () => ({
        loginId: "login-1",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-1234",
      })),
      waitForLogin: vi.fn(
        () => new Promise<void>((resolve) => { completeLogin = resolve; }),
      ),
      readAccount: vi.fn(),
      cancelLogin: vi.fn(async () => { completeLogin?.(); }),
      close: vi.fn(async () => undefined),
    };
    const worker = new DeviceAuthWorker({
      repository: repository as never,
      tokenStore: { delete: vi.fn() } as never,
      homeManager: { open: vi.fn(async () => home) } as never,
      runtimeId: "runtime-1",
      createClient: () => client as never,
      statusPollMilliseconds: 1,
    });

    await worker.tick();
    const drain = worker.drain();
    const outcome = await Promise.race([
      drain.then(() => "drained" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 25)),
    ]);

    allowRepositoryCancellation = true;
    await worker.drain();
    expect(outcome).toBe("drained");
    expect(client.cancelLogin).toHaveBeenCalledWith("login-1");
    expect(home.discard).toHaveBeenCalledOnce();
  });
});
