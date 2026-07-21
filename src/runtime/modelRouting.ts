export const modelAliases = [
  "reasoning_strong",
  "execution_balanced",
  "utility_fast",
] as const;
export type ModelAlias = (typeof modelAliases)[number];
export type AgentRole = "planner" | "worker" | "synthesizer" | "reviewer";

export function modelAliasForRole(role: AgentRole): ModelAlias {
  if (role === "planner" || role === "synthesizer") return "reasoning_strong";
  if (role === "worker") return "execution_balanced";
  return "utility_fast";
}

export function resolveModelAlias(alias: ModelAlias) {
  const fallback = process.env.OPENAI_MODEL || "gpt-5-mini";
  if (alias === "reasoning_strong") return process.env.OPENAI_REASONING_MODEL || fallback;
  if (alias === "execution_balanced") return process.env.OPENAI_EXECUTION_MODEL || fallback;
  return process.env.OPENAI_UTILITY_MODEL || fallback;
}
