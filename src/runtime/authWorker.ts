import {
  exchangeCodexAuthorizationCode,
  pollCodexDeviceAuthorization,
} from "./codexOAuth";
import { RuntimeRepository, type PendingAuthAttempt } from "./repository";
import { EncryptedTokenStore } from "./tokenStore";

export class DeviceAuthWorker {
  private readonly nextPollAt = new Map<string, number>();

  constructor(
    private readonly repository: RuntimeRepository,
    private readonly tokenStore: EncryptedTokenStore,
  ) {}

  async tick() {
    await this.repository.expirePendingAuthAttempts();
    const deletions = await this.repository.listTokenDeletionRequests();
    const cleanupResults = await Promise.allSettled(
      deletions.map(async ({ connection_id: connectionId }) => {
        await this.tokenStore.delete(connectionId);
        await this.repository.completeTokenDeletion(connectionId);
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

    const attempts = await this.repository.listPendingAuthAttempts();
    await Promise.all(attempts.map((attempt) => this.poll(attempt)));
  }

  private async poll(attempt: PendingAuthAttempt) {
    if ((this.nextPollAt.get(attempt.id) || 0) > Date.now()) return;
    const interval = Math.max(1, attempt.poll_interval_seconds);
    this.nextPollAt.set(attempt.id, Date.now() + interval * 1000);

    try {
      const result = await pollCodexDeviceAuthorization({
        deviceAuthId: attempt.device_auth_id,
        userCode: attempt.user_code,
      });
      if (result.status === "pending") return;
      if (result.status === "slow_down") {
        const slower = interval + 5;
        this.nextPollAt.set(attempt.id, Date.now() + slower * 1000);
        await this.repository.updateAuthAttempt(attempt.id, {
          poll_interval_seconds: slower,
        });
        return;
      }

      const credentials = await exchangeCodexAuthorizationCode(
        result.authorizationCode,
        result.codeVerifier,
      );
      await this.tokenStore.save(attempt.connection_id, credentials);
      await this.repository.updateConnection(attempt.connection_id, {
        status: "connected",
        secret_ref: `runtime:${attempt.connection_id}`,
        account_label: `OpenAI account ${credentials.accountId.slice(-6)}`,
        expires_at: new Date(credentials.expires).toISOString(),
        last_checked_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
      });
      await this.repository.updateAuthAttempt(attempt.id, {
        status: "authorized",
        device_auth_id: null,
        updated_at: new Date().toISOString(),
      });
      this.nextPollAt.delete(attempt.id);
    } catch (error) {
      await this.repository.updateAuthAttempt(attempt.id, {
        status: "error",
      });
      await this.repository.updateConnection(attempt.connection_id, {
        status: "error",
        last_error_code: error instanceof Error ? error.name : "DEVICE_AUTH_ERROR",
        last_error_message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      });
      this.nextPollAt.delete(attempt.id);
    }
  }
}
