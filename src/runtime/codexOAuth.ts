/**
 * Pi-compatible OpenAI Codex device authorization client.
 * Adapted from @earendil-works/pi-ai 0.80.6 (MIT), openai-codex OAuth module.
 * Only the OpenAI public-client device flow is retained.
 */
import type { CodexCredentials } from "./tokenStore";

export const PI_OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
export const CODEX_DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
export const CODEX_DEVICE_TIMEOUT_SECONDS = 15 * 60;

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class CodexAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexAuthenticationError";
  }
}

export type CodexDeviceAuthorization = {
  deviceAuthId: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresAt: number;
};

export async function startCodexDeviceAuthorization(
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<CodexDeviceAuthorization> {
  const response = await fetcher(DEVICE_USER_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: PI_OPENAI_CODEX_CLIENT_ID }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`OpenAI Codex device code request failed (${response.status}).`);
  }
  const json = (await response.json()) as Record<string, unknown>;
  const interval = typeof json.interval === "string" ? Number(json.interval) : json.interval;
  if (
    typeof json.device_auth_id !== "string" ||
    typeof json.user_code !== "string" ||
    typeof interval !== "number" ||
    !Number.isFinite(interval)
  ) {
    throw new Error("Invalid OpenAI Codex device code response.");
  }
  return {
    deviceAuthId: json.device_auth_id,
    userCode: json.user_code,
    verificationUri: CODEX_DEVICE_VERIFICATION_URI,
    intervalSeconds: Math.max(1, interval),
    expiresAt: Date.now() + CODEX_DEVICE_TIMEOUT_SECONDS * 1000,
  };
}

export async function pollCodexDeviceAuthorization(
  device: Pick<CodexDeviceAuthorization, "deviceAuthId" | "userCode">,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "authorized"; authorizationCode: string; codeVerifier: string }
> {
  const response = await fetcher(DEVICE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_auth_id: device.deviceAuthId,
      user_code: device.userCode,
    }),
    signal,
  });
  if (response.ok) {
    const json = (await response.json()) as Record<string, unknown>;
    if (typeof json.authorization_code !== "string" || typeof json.code_verifier !== "string") {
      throw new Error("Invalid OpenAI Codex device authorization response.");
    }
    return {
      status: "authorized",
      authorizationCode: json.authorization_code,
      codeVerifier: json.code_verifier,
    };
  }
  if (response.status === 403 || response.status === 404) return { status: "pending" };
  const body = await response.text();
  try {
    const error = (JSON.parse(body) as { error?: string | { code?: string } }).error;
    const code = typeof error === "string" ? error : error?.code;
    if (code === "deviceauth_authorization_pending") return { status: "pending" };
    if (code === "slow_down") return { status: "slow_down" };
  } catch {
    // Preserve the status-only error below.
  }
  throw new Error(`OpenAI Codex device authorization failed (${response.status}).`);
}

export async function exchangeCodexAuthorizationCode(
  authorizationCode: string,
  codeVerifier: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
) {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: PI_OPENAI_CODEX_CLIENT_ID,
      code: authorizationCode,
      code_verifier: codeVerifier,
      redirect_uri: DEVICE_REDIRECT_URI,
    }),
    signal,
  });
  return readCredentials(response, "exchange");
}

export async function refreshCodexCredentials(
  refreshToken: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: PI_OPENAI_CODEX_CLIENT_ID,
    }),
  });
  return readCredentials(response, "refresh");
}

async function readCredentials(response: Response, operation: string): Promise<CodexCredentials> {
  if (!response.ok) {
    const detail = await response.text();
    if (operation === "refresh" && [400, 401, 403].includes(response.status)) {
      throw new CodexAuthenticationError(
        `OpenAI Codex credentials were rejected during refresh (${response.status}): ${detail}`,
      );
    }
    throw new Error(`OpenAI Codex token ${operation} failed (${response.status}).`);
  }
  const json = (await response.json()) as Record<string, unknown>;
  if (
    typeof json.access_token !== "string" ||
    typeof json.refresh_token !== "string" ||
    typeof json.expires_in !== "number"
  ) {
    throw new Error(`OpenAI Codex token ${operation} response is incomplete.`);
  }
  const accountId = accountIdFromJwt(json.access_token);
  if (!accountId) throw new Error("OpenAI Codex token is missing an account id.");
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
  };
}

function accountIdFromJwt(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = decoded[JWT_CLAIM_PATH] as { chatgpt_account_id?: unknown } | undefined;
    return typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : null;
  } catch {
    return null;
  }
}
