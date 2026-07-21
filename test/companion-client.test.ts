import { describe, expect, it, vi } from "vitest";
import { CompanionClient } from "../src/runtime/companionClient";

const attemptId = "4d4bc614-9618-4d80-af23-cdb6b80480df";
const token = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";

describe("CompanionClient", () => {
  it("claims and updates only its paired attempt with a bearer token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ attempt: { id: attemptId } }))
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ renewed: true }));
    const client = createClient(fetch);

    await expect(client.claim()).resolves.toEqual({ id: attemptId });
    await client.publishPrompt({
      loginId: attemptId,
      verificationUri: "https://auth.openai.com/oauth/authorize?...",
    });
    await expect(client.renew()).resolves.toBe(true);

    expect(fetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { attemptId, action: "claim" },
      {
        attemptId,
        action: "prompt",
        loginId: attemptId,
        verificationUri: "https://auth.openai.com/oauth/authorize?...",
      },
      { attemptId, action: "renew" },
    ]);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${token}`,
    });
  });

  it("reads the transfer key and uploads ciphertext without a Supabase secret", async () => {
    const envelope = {
      version: 1,
      algorithm: "x25519-hkdf-sha256-aes-256-gcm",
      ephemeralPublicKey: "YWJj",
      salt: "YWJj",
      iv: "YWJj",
      tag: "YWJj",
      ciphertext: "YWJj",
    } as const;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ status: "pending", transferPublicKey: "PUBLIC" }))
      .mockResolvedValueOnce(response({ ok: true, status: "queued_import" }));
    const client = createClient(fetch);

    await expect(client.getStatus()).resolves.toEqual({
      status: "pending",
      transferPublicKey: "PUBLIC",
    });
    await client.uploadCredential({
      accountLabel: "member@example.com · plus",
      envelope,
    });

    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      attemptId,
      action: "credential",
      accountLabel: "member@example.com · plus",
      envelope,
    });
  });
});

function createClient(fetch: typeof globalThis.fetch) {
  return new CompanionClient({
    baseUrl: "https://solodot.example/",
    attemptId,
    token,
    fetch,
  });
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
