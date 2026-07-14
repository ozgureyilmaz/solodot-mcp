import { describe, expect, it, vi } from "vitest";
import {
  callCodexStructured,
  CodexUsageLimitError,
} from "../src/runtime/codexResponses";
import { CodexAuthenticationError } from "../src/runtime/codexOAuth";

const credentials = {
  access: "access-token",
  refresh: "refresh-token",
  expires: Date.now() + 60_000,
  accountId: "account-1",
};

describe("Pi-compatible Codex Responses transport", () => {
  it("sends Solodot attribution and parses streamed structured output", async () => {
    const stream = [
      'data: {"type":"response.output_text.delta","delta":"{\\"value\\":"}',
      'data: {"type":"response.output_text.delta","delta":"\\"ok\\"}"}',
      'data: {"type":"response.completed","response":{"status":"completed"}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const fetcher = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    await expect(
      callCodexStructured({
        credentials,
        model: "gpt-5.5",
        system: "System",
        user: "User",
        schema: { type: "object", properties: { value: { type: "string" } } },
        outputName: "result",
        fetcher,
      }),
    ).resolves.toEqual({ value: "ok" });

    const [, init] = fetcher.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as {
      text: { format: { schema: Record<string, unknown> } };
    };
    expect(headers.get("originator")).toBe("solodot");
    expect(headers.get("chatgpt-account-id")).toBe("account-1");
    expect(body.text.format.schema.additionalProperties).toBe(false);
  });

  it("classifies terminal subscription limits without retrying into API billing", async () => {
    const fetcher = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      new Response("FreeUsageLimitError: usage limit reached", { status: 403 }),
    );
    await expect(
      callCodexStructured({
        credentials,
        model: "gpt-5.5",
        system: "System",
        user: "User",
        schema: { type: "object" },
        outputName: "result",
        fetcher,
      }),
    ).rejects.toBeInstanceOf(CodexUsageLimitError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("classifies a rejected subscription access token as revoked authentication", async () => {
    const fetcher = vi.fn(async () =>
      new Response('{"error":"unauthorized"}', { status: 401 }),
    );
    await expect(
      callCodexStructured({
        credentials,
        model: "gpt-5.5",
        system: "System",
        user: "User",
        schema: { type: "object" },
        outputName: "result",
        fetcher,
      }),
    ).rejects.toBeInstanceOf(CodexAuthenticationError);
  });
});
