import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LocalCodexCompanion } from "../src/runtime/localCompanion";
import {
  decryptCodexCredential,
  type CredentialTransferEnvelope,
} from "../src/runtime/credentialTransfer";

describe("LocalCodexCompanion", () => {
  it("logs in from an isolated home and uploads only an encrypted cache", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("x25519");
    const attempt = {
      id: "4d4bc614-9618-4d80-af23-cdb6b80480df",
      connection_id: "connection-1",
      expires_at: "2099-07-21T10:15:00.000Z",
    };
    const companionClient = {
      getStatus: vi.fn(async () => ({
        status: "pending",
        transferPublicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      })),
      claim: vi.fn(async () => attempt),
      publishPrompt: vi.fn(async () => undefined),
      renew: vi.fn(async () => true),
      uploadCredential: vi.fn(
        async (_value: {
          accountLabel: string;
          envelope: CredentialTransferEnvelope;
        }) => undefined,
      ),
      fail: vi.fn(async () => undefined),
    };
    const home = {
      path: "/tmp/isolated-solodot-home",
      exportAndDiscard: vi.fn(async () => ({
        authJson: '{"tokens":{"access_token":"secret"}}',
      })),
      discard: vi.fn(async () => undefined),
    };
    const appServer = {
      initialize: vi.fn(async () => undefined),
      startChatGPTBrowserLogin: vi.fn(async () => ({
        loginId: attempt.id,
        authUrl: "https://auth.openai.com/oauth/authorize?...",
      })),
      waitForLogin: vi.fn(async () => undefined),
      readAccount: vi.fn(async () => ({
        account: { type: "chatgpt", email: "member@example.com", planType: "plus" },
      })),
      cancelLogin: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const companion = new LocalCodexCompanion({
      companionClient: companionClient as never,
      homeManager: { open: vi.fn(async () => home) } as never,
      createAppServerClient: () => appServer as never,
      statusPollMilliseconds: 1,
    });

    await expect(companion.run()).resolves.toBeUndefined();

    expect(companionClient.publishPrompt).toHaveBeenCalledWith({
      loginId: attempt.id,
      verificationUri: "https://auth.openai.com/oauth/authorize?...",
    });
    expect(companionClient.uploadCredential).toHaveBeenCalledOnce();
    const uploaded = companionClient.uploadCredential.mock.calls[0]?.[0];
    expect(uploaded?.accountLabel).toBe("member@example.com · plus");
    expect(JSON.stringify(uploaded?.envelope)).not.toContain("secret");
    expect(
      decryptCodexCredential({
        envelope: uploaded?.envelope,
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        attemptId: attempt.id,
      }),
    ).toBe('{"tokens":{"access_token":"secret"}}');
    expect(home.exportAndDiscard).toHaveBeenCalledOnce();
    expect(companionClient.fail).not.toHaveBeenCalled();
  });
});
