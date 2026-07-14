import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EncryptedTokenStore } from "../src/runtime/tokenStore";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("EncryptedTokenStore", () => {
  it("round-trips credentials without writing plaintext tokens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "solodot-token-test-"));
    dirs.push(directory);
    const store = new EncryptedTokenStore({
      directory,
      encryptionKey: Buffer.alloc(32, 7).toString("base64"),
    });
    const credentials = {
      access: "access-secret",
      refresh: "refresh-secret",
      expires: Date.now() + 60_000,
      accountId: "account-1",
    };

    await store.save("connection-1", credentials);
    expect(await store.load("connection-1")).toEqual(credentials);
    const encrypted = await readFile(join(directory, "connection-1.json"), "utf8");
    expect(encrypted).not.toContain("access-secret");
    expect(encrypted).not.toContain("refresh-secret");
  });

  it("rejects a key that is not exactly 32 bytes", () => {
    expect(
      () => new EncryptedTokenStore({ directory: "/tmp", encryptionKey: "short" }),
    ).toThrow("32-byte");
  });

  it("deletes an encrypted credential file idempotently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "solodot-token-test-"));
    dirs.push(directory);
    const store = new EncryptedTokenStore({
      directory,
      encryptionKey: Buffer.alloc(32, 7).toString("base64"),
    });
    await store.save("connection-1", {
      access: "access-secret",
      refresh: "refresh-secret",
      expires: Date.now() + 60_000,
      accountId: "account-1",
    });

    await store.delete("connection-1");
    await store.delete("connection-1");
    expect(await store.load("connection-1")).toBeNull();
  });
});
