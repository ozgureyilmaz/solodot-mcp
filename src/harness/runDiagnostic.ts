import { buildDiagnosticPrompt, diagnosticResultSchema } from "./contract";
import { callDiagnosticProvider } from "./providers";
import {
  HARNESS_VERSION,
  type DiagnosticIntake,
  type DiagnosticResult,
} from "./types";
import { normalizeDiagnosticResult } from "./validation";

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_VERTEX_MODEL = "gemini-2.5-flash-lite";

export async function runDiagnosticHarness(
  intake: DiagnosticIntake,
): Promise<DiagnosticResult> {
  const { apiKey, model } = getProviderConfig(intake.provider);
  const runId = `diag_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const { system, user } = buildDiagnosticPrompt(intake);

  const raw = await callDiagnosticProvider({
    provider: intake.provider,
    apiKey,
    model,
    system,
    user,
    schema: diagnosticResultSchema,
  });

  return normalizeDiagnosticResult({
    raw,
    provider: intake.provider,
    runId,
    createdAt,
  });
}

export function getProviderConfig(provider: DiagnosticIntake["provider"]) {
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new MissingProviderKeyError("ANTHROPIC_API_KEY");
    }
    return {
      apiKey,
      model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
    };
  }

  const apiKey = process.env.VERTEX_API_KEY;
  if (!apiKey) {
    throw new MissingProviderKeyError("VERTEX_API_KEY");
  }
  return {
    apiKey,
    model: process.env.VERTEX_MODEL || DEFAULT_VERTEX_MODEL,
  };
}

export class MissingProviderKeyError extends Error {
  envVar: string;

  constructor(envVar: string) {
    super(`${envVar} is required to run the ${HARNESS_VERSION}.`);
    this.name = "MissingProviderKeyError";
    this.envVar = envVar;
  }
}
