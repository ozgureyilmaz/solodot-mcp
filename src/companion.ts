#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompanionClient } from "./runtime/companionClient";
import { CodexHomeManager } from "./runtime/codexHome";
import { LocalCodexCompanion } from "./runtime/localCompanion";
import { EncryptedTokenStore } from "./runtime/tokenStore";

const baseUrl = required("SOLODOT_COMPANION_BASE_URL");
const attemptId = required("SOLODOT_COMPANION_ATTEMPT_ID");
const token = required("SOLODOT_COMPANION_TOKEN");
const temporaryRoot = await mkdtemp(join(tmpdir(), "solodot-companion-"));

try {
  const tokenStore = new EncryptedTokenStore({
    directory: join(temporaryRoot, "unused-token-cache"),
    encryptionKey: randomBytes(32).toString("base64"),
  });
  const companion = new LocalCodexCompanion({
    companionClient: new CompanionClient({ baseUrl, attemptId, token }),
    homeManager: new CodexHomeManager(tokenStore, join(temporaryRoot, "codex")),
  });
  process.stderr.write(
    "Starting an isolated Solodot sign-in. Complete the OpenAI page in your browser.\n",
  );
  await companion.run();
  process.stderr.write("Solodot received the encrypted subscription credential.\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
