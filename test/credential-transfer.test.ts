import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptCodexCredential,
  encryptCodexCredential,
} from "../src/runtime/credentialTransfer";

describe("Codex credential transfer", () => {
  it("encrypts for the runtime public key and binds ciphertext to the attempt", () => {
    const { publicKey, privateKey } = generateKeyPairSync("x25519");
    const envelope = encryptCodexCredential({
      authJson: '{"tokens":{"access_token":"secret"}}',
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      attemptId: "4d4bc614-9618-4d80-af23-cdb6b80480df",
    });

    expect(JSON.stringify(envelope)).not.toContain("secret");
    expect(
      decryptCodexCredential({
        envelope,
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        attemptId: "4d4bc614-9618-4d80-af23-cdb6b80480df",
      }),
    ).toBe('{"tokens":{"access_token":"secret"}}');
    expect(() =>
      decryptCodexCredential({
        envelope,
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        attemptId: "different-attempt",
      }),
    ).toThrow();
  });

  it("rejects malformed credential payloads and envelopes", () => {
    const { publicKey, privateKey } = generateKeyPairSync("x25519");
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    expect(() =>
      encryptCodexCredential({
        authJson: "not json",
        publicKey: publicPem,
        attemptId: "attempt-1",
      }),
    ).toThrow("Codex credential cache is invalid.");
    expect(() =>
      decryptCodexCredential({
        envelope: { version: 1 },
        privateKey: privatePem,
        attemptId: "attempt-1",
      }),
    ).toThrow("Credential transfer envelope is invalid.");
  });
});
