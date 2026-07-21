import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexHomeManager } from "../src/runtime/codexHome";
import { EncryptedTokenStore } from "../src/runtime/tokenStore";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("CodexHomeManager", () => {
  it("materializes auth only in a private temporary home", async () => {
    const root = await mkdtemp(join(tmpdir(), "solodot-codex-home-test-"));
    dirs.push(root);
    const store = new EncryptedTokenStore({
      directory: join(root, "encrypted"),
      encryptionKey: Buffer.alloc(32, 9).toString("base64"),
    });
    await store.save("connection-1", { authJson: '{"token":"secret"}' });
    const manager = new CodexHomeManager(store, join(root, "materialized"));

    const home = await manager.open("connection-1");

    expect(await readFile(join(home.path, "auth.json"), "utf8")).toBe(
      '{"token":"secret"}',
    );
    expect((await stat(home.path)).mode & 0o777).toBe(0o700);
    expect((await stat(join(home.path, "auth.json"))).mode & 0o777).toBe(0o600);
    expect(home.workspacePath).not.toBe(home.path);
    expect((await stat(home.workspacePath)).mode & 0o777).toBe(0o700);
    const config = await readFile(join(home.path, "config.toml"), "utf8");
    expect(config).toContain('cli_auth_credentials_store = "file"');
    expect(config).toContain('web_search = "disabled"');
    expect(config).toContain("shell_tool = false");
    expect(config).toContain("unified_exec = false");
    expect(config).toContain("apps = false");
    expect(config).toContain("plugins = false");
    await home.discard();
    await expect(stat(home.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(home.workspacePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("encrypts a refreshed app-server cache before removing the temporary home", async () => {
    const root = await mkdtemp(join(tmpdir(), "solodot-codex-home-test-"));
    dirs.push(root);
    const store = new EncryptedTokenStore({
      directory: join(root, "encrypted"),
      encryptionKey: Buffer.alloc(32, 9).toString("base64"),
    });
    const manager = new CodexHomeManager(store, join(root, "materialized"));
    const home = await manager.open("connection-1");
    await writeFile(join(home.path, "auth.json"), '{"token":"refreshed-secret"}', {
      mode: 0o600,
    });

    await home.persistAndDiscard();

    expect(await store.load("connection-1")).toEqual({
      authJson: '{"token":"refreshed-secret"}',
    });
    const encrypted = await readFile(
      join(root, "encrypted", "connection-1.json"),
      "utf8",
    );
    expect(encrypted).not.toContain("refreshed-secret");
    await expect(stat(home.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exports a new companion cache once and removes the temporary home", async () => {
    const root = await mkdtemp(join(tmpdir(), "solodot-codex-home-test-"));
    dirs.push(root);
    const store = new EncryptedTokenStore({
      directory: join(root, "encrypted"),
      encryptionKey: Buffer.alloc(32, 9).toString("base64"),
    });
    const manager = new CodexHomeManager(store, join(root, "materialized"));
    const home = await manager.open("connection-1");
    await writeFile(join(home.path, "auth.json"), '{"token":"companion-secret"}', {
      mode: 0o600,
    });

    await expect(home.exportAndDiscard()).resolves.toEqual({
      authJson: '{"token":"companion-secret"}',
    });
    await expect(stat(home.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.load("connection-1")).resolves.toBeNull();
  });
});
