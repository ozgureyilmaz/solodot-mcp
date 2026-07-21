import { describe, expect, it } from "vitest";
import { resolveCodexLoginMode } from "../src/runtime/loginMode";

describe("Codex login mode", () => {
  it("keeps the hosted device flow as the default", () => {
    expect(resolveCodexLoginMode({})).toBe("device");
  });

  it("requires an explicit local-runtime acknowledgement for browser OAuth", () => {
    expect(() =>
      resolveCodexLoginMode({ SOLODOT_CODEX_LOGIN_MODE: "browser" }),
    ).toThrow("SOLODOT_RUNTIME_LOCAL_BROWSER_AUTH=true");
  });

  it("enables browser OAuth for an explicitly acknowledged local runtime", () => {
    expect(
      resolveCodexLoginMode({
        SOLODOT_CODEX_LOGIN_MODE: "browser",
        SOLODOT_RUNTIME_LOCAL_BROWSER_AUTH: "true",
      }),
    ).toBe("browser");
  });

  it("rejects unknown login modes instead of silently changing auth behavior", () => {
    expect(() =>
      resolveCodexLoginMode({ SOLODOT_CODEX_LOGIN_MODE: "other" }),
    ).toThrow("SOLODOT_CODEX_LOGIN_MODE");
  });
});
