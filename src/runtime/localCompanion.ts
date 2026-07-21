import {
  CodexAppServerClient,
  createStdioCodexTransport,
} from "./codexAppServer";
import type { CompanionClient } from "./companionClient";
import type { CodexHomeManager } from "./codexHome";
import { encryptCodexCredential } from "./credentialTransfer";

type AppServerClient = Pick<
  CodexAppServerClient,
  | "initialize"
  | "startChatGPTBrowserLogin"
  | "waitForLogin"
  | "readAccount"
  | "cancelLogin"
  | "close"
>;

type LocalCompanionOptions = {
  companionClient: Pick<
    CompanionClient,
    | "getStatus"
    | "claim"
    | "publishPrompt"
    | "renew"
    | "uploadCredential"
    | "fail"
  >;
  homeManager: CodexHomeManager;
  createAppServerClient?: (codexHome: string) => AppServerClient;
  statusPollMilliseconds?: number;
};

export class LocalCodexCompanion {
  private readonly createAppServerClient: (codexHome: string) => AppServerClient;
  private readonly statusPollMilliseconds: number;

  constructor(private readonly options: LocalCompanionOptions) {
    this.createAppServerClient =
      options.createAppServerClient ||
      ((codexHome) =>
        new CodexAppServerClient(createStdioCodexTransport({ codexHome })));
    this.statusPollMilliseconds = options.statusPollMilliseconds || 2_000;
  }

  async run() {
    let home: Awaited<ReturnType<CodexHomeManager["open"]>> | null = null;
    let appServer: AppServerClient | null = null;
    let closed = false;
    let exported = false;
    let monitoring = true;
    let cancelled = false;
    try {
      const initial = await this.options.companionClient.getStatus();
      const attempt = parseAttempt(await this.options.companionClient.claim());
      home = await this.options.homeManager.open(attempt.connectionId);
      appServer = this.createAppServerClient(home.path);
      await appServer.initialize();
      const login = await appServer.startChatGPTBrowserLogin();
      await this.options.companionClient.publishPrompt({
        loginId: login.loginId,
        verificationUri: login.authUrl,
      });

      const loginOutcome = appServer
        .waitForLogin(
          login.loginId,
          Math.max(1, Date.parse(attempt.expiresAt) - Date.now()),
        )
        .then(() => ({ kind: "connected" as const }));
      const statusOutcome = this.monitor(() => monitoring);
      const outcome = await Promise.race([loginOutcome, statusOutcome]);
      monitoring = false;
      if (outcome.kind !== "connected") {
        cancelled = true;
        await appServer.cancelLogin(login.loginId).catch(() => undefined);
        return;
      }

      const accountResult = await appServer.readAccount(true);
      const account = accountResult.account as Record<string, unknown> | undefined;
      if (!account || account.type !== "chatgpt") {
        throw new Error("Codex app-server did not return a managed ChatGPT account.");
      }
      await appServer.close();
      closed = true;
      const credentials = await home.exportAndDiscard();
      exported = true;
      const email = typeof account.email === "string" ? account.email : "ChatGPT account";
      const plan = typeof account.planType === "string" ? account.planType : "subscription";
      await this.options.companionClient.uploadCredential({
        accountLabel: `${email} · ${plan}`,
        envelope: encryptCodexCredential({
          authJson: credentials.authJson,
          publicKey: initial.transferPublicKey,
          attemptId: attempt.id,
        }),
      });
    } catch (error) {
      if (!cancelled) await this.options.companionClient.fail().catch(() => undefined);
      throw error;
    } finally {
      monitoring = false;
      if (appServer && !closed) await appServer.close().catch(() => undefined);
      if (home && !exported) await home.discard();
    }
  }

  private async monitor(shouldContinue: () => boolean) {
    while (shouldContinue()) {
      await delay(this.statusPollMilliseconds);
      if (!shouldContinue()) break;
      const status = await this.options.companionClient.getStatus();
      if (["cancelled", "expired", "error"].includes(status.status)) {
        return { kind: status.status as "cancelled" | "expired" | "error" };
      }
      if (!(await this.options.companionClient.renew())) {
        return { kind: "lease_lost" as const };
      }
    }
    return { kind: "lease_lost" as const };
  }
}

function parseAttempt(value: Record<string, unknown>) {
  if (
    typeof value.id !== "string" ||
    typeof value.connection_id !== "string" ||
    typeof value.expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.expires_at))
  ) {
    throw new Error("Companion claim returned an invalid attempt.");
  }
  return {
    id: value.id,
    connectionId: value.connection_id,
    expiresAt: value.expires_at,
  };
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
