import { describe, expect, it } from "vitest";
import { selectOpenAIConnection } from "../src/runtime/connectionSelection";

describe("runtime OpenAI connection selection", () => {
  it("pauses before a subscription-limit fallback can create API charges", () => {
    expect(
      selectOpenAIConnection({
        preferredMode: "codex_subscription",
        connections: [
          { mode: "codex_subscription", status: "rate_limited" },
          { mode: "api_key", status: "connected" },
        ],
      }),
    ).toMatchObject({ state: "approval_required", fallbackMode: "api_key" });
  });
});
