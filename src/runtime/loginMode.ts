export type CodexLoginMode = "device" | "browser";

export function resolveCodexLoginMode(
  environment: Record<string, string | undefined>,
): CodexLoginMode {
  const mode = environment.SOLODOT_CODEX_LOGIN_MODE || "device";
  if (mode !== "device" && mode !== "browser") {
    throw new Error("SOLODOT_CODEX_LOGIN_MODE must be device or browser.");
  }
  if (
    mode === "browser" &&
    environment.SOLODOT_RUNTIME_LOCAL_BROWSER_AUTH !== "true"
  ) {
    throw new Error(
      "Browser OAuth requires SOLODOT_RUNTIME_LOCAL_BROWSER_AUTH=true because its callback is bound to the customer's localhost.",
    );
  }
  return mode;
}
