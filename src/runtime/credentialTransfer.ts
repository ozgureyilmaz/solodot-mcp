import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "x25519-hkdf-sha256-aes-256-gcm";
const INFO = Buffer.from("solodot-codex-credential-transfer-v1");
const MAX_AUTH_JSON_BYTES = 256 * 1024;

export type CredentialTransferEnvelope = {
  version: 1;
  algorithm: typeof ALGORITHM;
  ephemeralPublicKey: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export function encryptCodexCredential({
  authJson,
  publicKey,
  attemptId,
}: {
  authJson: string;
  publicKey: string;
  attemptId: string;
}): CredentialTransferEnvelope {
  validateAuthJson(authJson);
  validateAttemptId(attemptId);
  const recipientPublicKey = createPublicKey(publicKey);
  if (recipientPublicKey.asymmetricKeyType !== "x25519") {
    throw new Error("Runtime transfer public key must be X25519.");
  }
  const ephemeral = generateKeyPairSync("x25519");
  const salt = randomBytes(32);
  const sharedSecret = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: recipientPublicKey,
  });
  const key = Buffer.from(hkdfSync("sha256", sharedSecret, salt, INFO, 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(attemptId));
  const ciphertext = Buffer.concat([
    cipher.update(authJson, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    algorithm: ALGORITHM,
    ephemeralPublicKey: ephemeral.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64"),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptCodexCredential({
  envelope,
  privateKey,
  attemptId,
}: {
  envelope: unknown;
  privateKey: string;
  attemptId: string;
}) {
  validateAttemptId(attemptId);
  const parsed = parseEnvelope(envelope);
  const recipientPrivateKey = createPrivateKey(privateKey);
  if (recipientPrivateKey.asymmetricKeyType !== "x25519") {
    throw new Error("Runtime transfer private key must be X25519.");
  }
  const ephemeralPublicKey = createPublicKey({
    key: decodeBase64(parsed.ephemeralPublicKey, 128),
    type: "spki",
    format: "der",
  });
  if (ephemeralPublicKey.asymmetricKeyType !== "x25519") {
    throw new Error("Credential transfer envelope is invalid.");
  }
  const salt = decodeBase64(parsed.salt, 32);
  const iv = decodeBase64(parsed.iv, 12);
  const tag = decodeBase64(parsed.tag, 16);
  const ciphertext = decodeBase64(parsed.ciphertext, MAX_AUTH_JSON_BYTES + 32);
  const sharedSecret = diffieHellman({
    privateKey: recipientPrivateKey,
    publicKey: ephemeralPublicKey,
  });
  const key = Buffer.from(hkdfSync("sha256", sharedSecret, salt, INFO, 32));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad(attemptId));
  decipher.setAuthTag(tag);
  const authJson = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  validateAuthJson(authJson);
  return authJson;
}

function parseEnvelope(value: unknown): CredentialTransferEnvelope {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).version !== 1 ||
    (value as Record<string, unknown>).algorithm !== ALGORITHM
  ) {
    throw new Error("Credential transfer envelope is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = [
    "ephemeralPublicKey",
    "salt",
    "iv",
    "tag",
    "ciphertext",
  ] as const;
  if (keys.some((key) => typeof record[key] !== "string")) {
    throw new Error("Credential transfer envelope is invalid.");
  }
  return record as CredentialTransferEnvelope;
}

function validateAuthJson(value: string) {
  if (Buffer.byteLength(value, "utf8") > MAX_AUTH_JSON_BYTES) {
    throw new Error("Codex credential cache is invalid.");
  }
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error();
    }
  } catch {
    throw new Error("Codex credential cache is invalid.");
  }
}

function validateAttemptId(value: string) {
  if (!value || value.length > 128) throw new Error("Invalid attempt id.");
}

function aad(attemptId: string) {
  return Buffer.from(`solodot-codex-credential-transfer-v1:${attemptId}`);
}

function decodeBase64(value: string, expectedMaximum: number) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Credential transfer envelope is invalid.");
  }
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.length > expectedMaximum) {
    throw new Error("Credential transfer envelope is invalid.");
  }
  return decoded;
}
