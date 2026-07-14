import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type CodexCredentials = {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
};

type EncryptedEnvelope = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

export class EncryptedTokenStore {
  private readonly key: Buffer;

  constructor(
    private readonly options: { directory: string; encryptionKey: string },
  ) {
    this.key = decodeKey(options.encryptionKey);
  }

  async save(connectionId: string, credentials: CodexCredentials) {
    const path = this.pathFor(connectionId);
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(connectionId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credentials), "utf8"),
      cipher.final(),
    ]);
    const envelope: EncryptedEnvelope = {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(envelope), { mode: 0o600 });
    await rename(temporary, path);
  }

  async load(connectionId: string): Promise<CodexCredentials | null> {
    let raw: string;
    try {
      raw = await readFile(this.pathFor(connectionId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const envelope = JSON.parse(raw) as EncryptedEnvelope;
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
      throw new Error("Unsupported encrypted token format.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(connectionId));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as CodexCredentials;
  }

  async delete(connectionId: string) {
    await rm(this.pathFor(connectionId), { force: true });
  }

  private pathFor(connectionId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(connectionId)) {
      throw new Error("Invalid connection id.");
    }
    return join(this.options.directory, `${connectionId}.json`);
  }
}

function decodeKey(value: string) {
  const trimmed = value.trim();
  const key = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error("SOLODOT_RUNTIME_ENCRYPTION_KEY must decode to a 32-byte key.");
  }
  return key;
}
