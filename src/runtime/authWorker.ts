import {
  CodexAppServerClient,
  createStdioCodexTransport,
} from "./codexAppServer";
import { CodexHomeManager } from "./codexHome";
import { RuntimeRepository, type PendingAuthAttempt } from "./repository";
import { EncryptedTokenStore } from "./tokenStore";

type AuthClient = Pick<
  CodexAppServerClient,
  | "initialize"
  | "startChatGPTDeviceLogin"
  | "startChatGPTBrowserLogin"
  | "waitForLogin"
  | "readAccount"
  | "cancelLogin"
  | "close"
>;

type AuthWorkerOptions = {
  repository: RuntimeRepository;
  tokenStore: EncryptedTokenStore;
  homeManager: CodexHomeManager;
  runtimeId: string;
  createClient?: (codexHome: string) => AuthClient;
  statusPollMilliseconds?: number;
  capacity?: number;
  leaseSeconds?: number;
  loginMode?: "device" | "browser";
};

export class DeviceAuthWorker {
  private readonly active = new Map<string, Promise<void>>();
  private readonly createClient: (codexHome: string) => AuthClient;
  private readonly statusPollMilliseconds: number;
  private readonly capacity: number;
  private readonly leaseSeconds: number;
  private readonly loginMode: "device" | "browser";
  private draining = false;

  constructor(private readonly options: AuthWorkerOptions) {
    this.createClient =
      options.createClient ||
      ((codexHome) =>
        new CodexAppServerClient(createStdioCodexTransport({ codexHome })));
    this.statusPollMilliseconds = options.statusPollMilliseconds || 2_000;
    this.capacity = options.capacity || 4;
    this.leaseSeconds = options.leaseSeconds || 60;
    this.loginMode = options.loginMode || "device";
  }

  async tick() {
    if (this.draining) return;
    await this.options.repository.expirePendingAuthAttempts();
    const deletions = await this.options.repository.listTokenDeletionRequests();
    const cleanupResults = await Promise.allSettled(
      deletions.map(async ({ connection_id: connectionId }) => {
        await this.options.tokenStore.delete(connectionId);
        await this.options.repository.completeTokenDeletion(connectionId);
      }),
    );
    for (const result of cleanupResults) {
      if (result.status === "rejected") {
        process.stderr.write(
          `Runtime token cleanup failed: ${
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          }\n`,
        );
      }
    }

    const available = Math.max(0, this.capacity - this.active.size);
    if (!available) return;
    const attempts = await this.options.repository.claimAuthAttempts(
      this.options.runtimeId,
      available,
      this.leaseSeconds,
    );
    for (const attempt of attempts) {
      if (this.active.has(attempt.id)) continue;
      const work = this.process(attempt).finally(() => this.active.delete(attempt.id));
      this.active.set(attempt.id, work);
    }
  }

  async drain() {
    this.draining = true;
    await Promise.allSettled([...this.active.values()]);
  }

  private async process(attempt: PendingAuthAttempt) {
    let home: Awaited<ReturnType<CodexHomeManager["open"]>> | null = null;
    let client: AuthClient | null = null;
    let persisted = false;
    let closed = false;
    let monitoring = true;
    try {
      home = await this.options.homeManager.open(attempt.connection_id);
      client = this.createClient(home.path);
      await client.initialize();
      const login =
        this.loginMode === "browser"
          ? await client.startChatGPTBrowserLogin()
          : await client.startChatGPTDeviceLogin();
      await this.options.repository.updateAuthAttempt(attempt.id, {
        status: "pending",
        device_auth_id: login.loginId,
        user_code: "userCode" in login ? login.userCode : null,
        verification_uri:
          "verificationUrl" in login ? login.verificationUrl : login.authUrl,
        poll_interval_seconds: Math.max(1, Math.ceil(this.statusPollMilliseconds / 1_000)),
        lease_expires_at: new Date(
          Date.now() + this.leaseSeconds * 1_000,
        ).toISOString(),
      });

      const loginOutcome = client
        .waitForLogin(login.loginId, Math.max(1, Date.parse(attempt.expires_at) - Date.now()))
        .then(() => ({ kind: "connected" as const }))
        .catch((error) => ({ kind: "error" as const, error }));
      const statusOutcome = this.monitorAttempt(
        attempt.id,
        () => monitoring && !this.draining,
      );
      const outcome = await Promise.race([loginOutcome, statusOutcome]);
      monitoring = false;

      if (outcome.kind === "cancelled" || outcome.kind === "expired" || outcome.kind === "lease_lost") {
        await client.cancelLogin(login.loginId).catch(() => undefined);
        return;
      }
      if (outcome.kind === "error") throw outcome.error;

      const accountResult = await client.readAccount(true);
      const account = accountResult.account as Record<string, unknown> | undefined;
      if (!account || account.type !== "chatgpt") {
        throw new Error("Codex app-server did not return a managed ChatGPT account.");
      }
      await client.close();
      closed = true;
      await home.persistAndDiscard();
      persisted = true;

      const email = typeof account.email === "string" ? account.email : "ChatGPT account";
      const plan = typeof account.planType === "string" ? account.planType : "subscription";
      await this.options.repository.updateConnection(attempt.connection_id, {
        status: "connected",
        secret_ref: `runtime:${attempt.connection_id}`,
        account_label: `${email} · ${plan}`,
        expires_at: null,
        last_checked_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
      });
      await this.options.repository.updateAuthAttempt(attempt.id, {
        status: "authorized",
        device_auth_id: null,
        user_code: null,
        runtime_id: null,
        lease_expires_at: null,
      });
    } catch (error) {
      monitoring = false;
      const status = await this.options.repository
        .getAuthAttemptStatus(attempt.id)
        .catch(() => null);
      if (!status || !["cancelled", "expired"].includes(status)) {
        await this.options.repository.updateAuthAttempt(attempt.id, {
          status: "error",
          runtime_id: null,
          lease_expires_at: null,
        });
        await this.options.repository.updateConnection(attempt.connection_id, {
          status: "error",
          last_error_code:
            error instanceof Error ? error.name : "CODEX_APP_SERVER_AUTH_ERROR",
          last_error_message:
            error instanceof Error
              ? error.message.slice(0, 500)
              : String(error).slice(0, 500),
        });
      }
    } finally {
      monitoring = false;
      if (client && !closed) await client.close().catch(() => undefined);
      if (home && !persisted) await home.discard();
    }
  }

  private async monitorAttempt(
    attemptId: string,
    shouldContinue: () => boolean,
  ): Promise<
    | { kind: "cancelled" }
    | { kind: "expired" }
    | { kind: "lease_lost" }
  > {
    while (true) {
      await delay(this.statusPollMilliseconds);
      if (!shouldContinue()) return { kind: "lease_lost" };
      const renewed = await this.options.repository.renewAuthAttemptLease(
        attemptId,
        this.options.runtimeId,
        this.leaseSeconds,
      );
      if (!renewed) return { kind: "lease_lost" };
      const status = await this.options.repository.getAuthAttemptStatus(attemptId);
      if (status === "cancelled") return { kind: "cancelled" };
      if (status === "expired") return { kind: "expired" };
    }
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
