import type { CredentialTransferEnvelope } from "./credentialTransfer";

type CompanionClientOptions = {
  baseUrl: string;
  attemptId: string;
  token: string;
  fetch?: typeof globalThis.fetch;
};

export class CompanionClient {
  private readonly endpoint: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly options: CompanionClientOptions) {
    const baseUrl = new URL(options.baseUrl);
    if (
      baseUrl.protocol !== "https:" &&
      !(baseUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(baseUrl.hostname))
    ) {
      throw new Error("Companion base URL must use HTTPS.");
    }
    if (!isUuid(options.attemptId)) throw new Error("Invalid companion attempt id.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(options.token)) {
      throw new Error("Invalid companion pairing token.");
    }
    this.endpoint = new URL(
      "/api/openai/subscription/companion",
      baseUrl,
    ).toString();
    this.fetch = options.fetch || globalThis.fetch;
  }

  async getStatus() {
    const response = await this.request(
      `${this.endpoint}?attempt=${encodeURIComponent(this.options.attemptId)}`,
      { method: "GET" },
    );
    if (
      typeof response.status !== "string" ||
      typeof response.transferPublicKey !== "string"
    ) {
      throw new Error("Companion status response is invalid.");
    }
    return {
      status: response.status,
      transferPublicKey: response.transferPublicKey,
    };
  }

  async claim() {
    const response = await this.command({ action: "claim" });
    if (!isRecord(response.attempt)) {
      throw new Error("Companion claim returned an invalid attempt.");
    }
    return response.attempt;
  }

  async publishPrompt({
    loginId,
    verificationUri,
  }: {
    loginId: string;
    verificationUri: string;
  }) {
    await this.command({ action: "prompt", loginId, verificationUri });
  }

  async renew() {
    const response = await this.command({ action: "renew" });
    return response.renewed === true;
  }

  async uploadCredential({
    accountLabel,
    envelope,
  }: {
    accountLabel: string;
    envelope: CredentialTransferEnvelope;
  }) {
    await this.command({ action: "credential", accountLabel, envelope });
  }

  async fail() {
    await this.command({ action: "error" });
  }

  private command(command: Record<string, unknown>) {
    return this.request(this.endpoint, {
      method: "POST",
      body: JSON.stringify({ attemptId: this.options.attemptId, ...command }),
    });
  }

  private async request(url: string, init: RequestInit) {
    const response = await this.fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        typeof body.error === "string"
          ? body.error
          : `Companion request failed (${response.status}).`,
      );
    }
    return body;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
