import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseDiagnosticIntake } from "../src/harness/validation";
import { intake } from "./fixtures";

async function readRuntimeSources(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return readRuntimeSources(entryPath);
      if (!entry.name.endsWith(".ts")) return "";
      return readFile(entryPath, "utf8");
    }),
  );

  return contents.join("\n");
}

describe("OpenAI-only public contract", () => {
  it("does not accept a browser-selected model provider", () => {
    expect(parseDiagnosticIntake({ ...intake, provider: "untrusted" })).toEqual(intake);
  });

  it("uses the official Codex app-server instead of copied OAuth or private endpoints", async () => {
    const sources = await readRuntimeSources(path.resolve("src/runtime"));

    expect(sources).not.toContain("app_EMoam");
    expect(sources).not.toContain("/api/accounts/deviceauth/");
    expect(sources).not.toContain("/oauth/token");
    expect(sources).not.toContain("chatgpt.com/backend-api/codex/responses");
    expect(sources).toContain('"app-server"');
    expect(sources).toContain("chatgptDeviceCode");
  });

  it("drains active device authorization before the runtime stops", async () => {
    const runtimeEntry = await readFile(path.resolve("src/runtime.ts"), "utf8");

    expect(runtimeEntry).toContain("await authWorker.drain();");
  });
});
