/**
 * Minimal Solodot transport for the OpenAI Codex subscription Responses route.
 * Request shape and account headers are adapted from @earendil-works/pi-ai
 * 0.80.6 (MIT), openai-codex-responses. The broad Pi provider stack is not
 * installed, keeping this runtime OpenAI-only.
 */
import type { JsonSchema } from "../harness/types";
import { CodexAuthenticationError } from "./codexOAuth";
import type { CodexCredentials } from "./tokenStore";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const terminalLimitPattern =
  /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i;

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class CodexUsageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexUsageLimitError";
  }
}

export async function callCodexStructured({
  credentials,
  model,
  system,
  user,
  schema,
  outputName,
  outputDescription = "Emit the requested structured result.",
  fetcher = fetch,
  signal,
}: {
  credentials: CodexCredentials;
  model: string;
  system: string;
  user: string;
  schema: JsonSchema;
  outputName: string;
  outputDescription?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
}) {
  const response = await fetcher(CODEX_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.access}`,
      "chatgpt-account-id": credentials.accountId,
      originator: "solodot",
      "User-Agent": `solodot-runtime/${process.env.npm_package_version || "0.1.0"}`,
      "OpenAI-Beta": "responses=experimental",
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      stream: true,
      instructions: system,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: user }],
        },
      ],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: outputName,
          description: outputDescription,
          schema: strictJsonSchema(schema),
          strict: true,
        },
      },
      include: ["reasoning.encrypted_content"],
      parallel_tool_calls: true,
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text();
    if (terminalLimitPattern.test(detail)) {
      throw new CodexUsageLimitError(detail || "Codex subscription usage limit reached.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new CodexAuthenticationError(
        `OpenAI Codex subscription credentials were rejected (${response.status}): ${detail}`,
      );
    }
    throw new Error(`Codex Responses request failed (${response.status}): ${detail}`);
  }

  const output = parseCodexEventStream(await response.text());
  if (!output) throw new Error("Codex Responses returned no structured output.");
  return parseStructuredJson(output);
}

export function parseCodexEventStream(stream: string) {
  let output = "";
  for (const line of stream.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      output += event.delta;
      continue;
    }
    if (!output && event.type === "response.output_text.done" && typeof event.text === "string") {
      output = event.text;
      continue;
    }
    if (!output && event.type === "response.completed") {
      output = findOutputText(event.response);
    }
  }
  return output;
}

function findOutputText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return "";
  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && typeof block === "object") {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === "string") return text;
      }
    }
  }
  return "";
}

function parseStructuredJson(value: string) {
  const fenced = value.match(/```json\s*([\s\S]*?)\s*```/i);
  return JSON.parse((fenced?.[1] || value).trim()) as unknown;
}

function strictJsonSchema(schema: JsonSchema): Record<string, unknown> {
  const output: Record<string, unknown> = { ...schema };
  if (schema.type === "object") output.additionalProperties = false;
  if (schema.properties) {
    output.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        strictJsonSchema(value),
      ]),
    );
  }
  if (schema.items) output.items = strictJsonSchema(schema.items);
  return output;
}
