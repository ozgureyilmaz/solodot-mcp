import { describe, expect, it, vi } from "vitest";
import {
  CodexAuthenticationError,
  exchangeCodexAuthorizationCode,
  pollCodexDeviceAuthorization,
  refreshCodexCredentials,
  startCodexDeviceAuthorization,
} from "../src/runtime/codexOAuth";

describe("Pi-compatible Codex device authorization", () => {
  it("starts the public-client device flow", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ device_auth_id: "device-1", user_code: "ABCD-EFGH", interval: "5" }),
        { status: 200 },
      ),
    );
    await expect(startCodexDeviceAuthorization(fetcher)).resolves.toMatchObject({
      deviceAuthId: "device-1",
      userCode: "ABCD-EFGH",
      verificationUri: "https://auth.openai.com/codex/device",
      intervalSeconds: 5,
    });
  });

  it("treats authorization-pending responses as retryable", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 403 }));
    await expect(
      pollCodexDeviceAuthorization(
        { deviceAuthId: "device-1", userCode: "ABCD-EFGH" },
        fetcher,
      ),
    ).resolves.toEqual({ status: "pending" });
  });

  it("exchanges the device authorization code for account-scoped credentials", async () => {
    const payload = Buffer.from(
      JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } }),
    ).toString("base64url");
    const access = `header.${payload}.signature`;
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: access, refresh_token: "refresh", expires_in: 3600 }),
        { status: 200 },
      ),
    );
    await expect(
      exchangeCodexAuthorizationCode("authorization", "verifier", fetcher),
    ).resolves.toMatchObject({ access, refresh: "refresh", accountId: "acct-1" });
  });

  it("classifies a rejected refresh token as revoked authentication", async () => {
    const fetcher = vi.fn(async () =>
      new Response('{"error":"invalid_grant"}', { status: 400 }),
    );

    await expect(
      refreshCodexCredentials("revoked-refresh-token", fetcher),
    ).rejects.toBeInstanceOf(CodexAuthenticationError);
  });
});
