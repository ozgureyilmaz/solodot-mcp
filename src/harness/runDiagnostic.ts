import { buildDiagnosticPrompt, diagnosticResultSchema } from "./contract";
import { callDiagnosticOpenAI } from "./openai";
import {
  HARNESS_VERSION,
  type DiagnosticIntake,
  type DiagnosticResult,
} from "./types";
import { normalizeDiagnosticResult } from "./validation";

const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

export async function runDiagnosticHarness(
  intake: DiagnosticIntake,
): Promise<DiagnosticResult> {
  const { apiKey, model } = getOpenAIConfig();
  const runId = `diag_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const { system, user } = buildDiagnosticPrompt(intake);

  const raw = await callDiagnosticOpenAI({
    apiKey,
    model,
    system,
    user,
    schema: diagnosticResultSchema,
  });

  return normalizeDiagnosticResult({
    raw,
    runId,
    createdAt,
  });
}

export function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new MissingOpenAIKeyError("OPENAI_API_KEY");
  }
  return {
    apiKey,
    model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
  };
}

export class MissingOpenAIKeyError extends Error {
  envVar: string;

  constructor(envVar: string) {
    super(`${envVar} is required to run the ${HARNESS_VERSION}.`);
    this.name = "MissingOpenAIKeyError";
    this.envVar = envVar;
  }
}
