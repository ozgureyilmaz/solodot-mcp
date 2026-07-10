import { createHash, timingSafeEqual } from "node:crypto";

export class McpAuthenticationError extends Error {
  constructor(message = "A valid Solodot MCP bearer token is required.") {
    super(message);
    this.name = "McpAuthenticationError";
  }
}

export function readBearerToken(authorization: string | undefined) {
  const value = authorization?.trim() || "";
  if (!value.toLowerCase().startsWith("bearer ")) {
    throw new McpAuthenticationError();
  }
  const token = value.slice(7).trim();
  if (!token) throw new McpAuthenticationError();
  return token;
}

export function authenticateBearer(
  authorization: string | undefined,
  allowedTokens: string[],
) {
  const token = readBearerToken(authorization);
  const candidate = digest(token);
  const matched = allowedTokens.some((allowed) => {
    const expected = digest(allowed);
    return timingSafeEqual(candidate, expected);
  });
  if (!matched) throw new McpAuthenticationError();
  return token;
}

export function configuredApiKeys(envValue = process.env.SOLODOT_MCP_API_KEYS) {
  return (envValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}
