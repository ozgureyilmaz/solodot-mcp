import { afterEach, describe, expect, it, vi } from "vitest";
import { callStructuredProvider } from "../src/harness/providers";

const schema = {
  type: "object",
  required: ["value"],
  properties: { value: { type: "string" } },
};

describe("shared provider adapters", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the requested Anthropic structured-output tool name", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools[0].name).toBe("execution_asset");
      expect(body.tool_choice.name).toBe("execution_asset");
      return new Response(
        JSON.stringify({
          content: [
            { type: "tool_use", name: "execution_asset", input: { value: "ok" } },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callStructuredProvider(
        {
          provider: "anthropic",
          apiKey: "test",
          model: "test-model",
          system: "system",
          user: "user",
          schema,
        },
        "execution_asset",
      ),
    ).resolves.toEqual({ value: "ok" });
  });

  it("normalizes a Vertex JSON response through the same contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"value":"vertex"}' }] } }],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      callStructuredProvider({
        provider: "vertex",
        apiKey: "cloud-key",
        model: "test-model",
        system: "system",
        user: "user",
        schema,
      }),
    ).resolves.toEqual({ value: "vertex" });
  });
});
