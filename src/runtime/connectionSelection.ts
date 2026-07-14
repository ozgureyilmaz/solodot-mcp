export type OpenAIAuthMode = "api_key" | "codex_subscription";
export type ConnectionStatus = "pending" | "connected" | "expired" | "rate_limited" | "revoked" | "error";

export function selectOpenAIConnection({
  preferredMode,
  connections,
}: {
  preferredMode: OpenAIAuthMode | null;
  connections: Array<{ mode: OpenAIAuthMode; status: ConnectionStatus }>;
}) {
  const preferred = preferredMode
    ? connections.find((connection) => connection.mode === preferredMode)
    : undefined;
  if (preferred?.status === "connected") {
    return { state: "ready" as const, selectedMode: preferred.mode, fallbackMode: null };
  }
  const apiKey = connections.find(
    (connection) => connection.mode === "api_key" && connection.status === "connected",
  );
  if (preferredMode === "codex_subscription" && preferred && apiKey) {
    return {
      state: "approval_required" as const,
      selectedMode: null,
      fallbackMode: "api_key" as const,
    };
  }
  const subscription = connections.find(
    (connection) => connection.mode === "codex_subscription" && connection.status === "connected",
  );
  if (subscription) {
    return { state: "ready" as const, selectedMode: subscription.mode, fallbackMode: null };
  }
  return { state: "connection_required" as const, selectedMode: null, fallbackMode: null };
}
