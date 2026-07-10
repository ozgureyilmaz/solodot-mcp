import type { JsonSchema, ProviderCallOptions } from "./types";
import { safeParseJSON } from "./validation";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const VERTEX_API_BASE = "https://aiplatform.googleapis.com/v1/publishers/google/models";
const GEMINI_STUDIO_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const CALL_TIMEOUT_MS = 60000;

type AnthropicResponse = {
  content?: Array<
    | { type: "text"; text?: string }
    | { type: "tool_use"; name?: string; input?: unknown }
  >;
};

type VertexResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
};

export async function callStructuredProvider(
  options: ProviderCallOptions,
  outputName = "structured_result",
  outputDescription = "Emit the requested structured result.",
) {
  if (options.provider === "anthropic") {
    return callAnthropic(options, outputName, outputDescription);
  }

  return callVertex(options);
}

export async function callDiagnosticProvider(options: ProviderCallOptions) {
  return callStructuredProvider(
    options,
    "diagnostic_result",
    "Emit the Solodot diagnostic harness result.",
  );
}

async function callAnthropic(
  { apiKey, model, system, user, schema }: ProviderCallOptions,
  outputName: string,
  outputDescription: string,
) {
  const data = await fetchWithTimeout<AnthropicResponse>(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2500,
      temperature: 0.3,
      system,
      messages: [{ role: "user", content: user }],
      tools: [
        {
          name: outputName,
          description: outputDescription,
          input_schema: schema,
        },
      ],
      tool_choice: { type: "tool", name: outputName },
    }),
  });

  const toolBlock = data.content?.find(
    (block) => block.type === "tool_use" && block.name === outputName,
  );

  if (toolBlock?.type === "tool_use" && toolBlock.input) {
    return toolBlock.input;
  }

  const text = data.content?.find((block) => block.type === "text")?.text;
  if (!text) {
    throw new Error("Anthropic returned no structured result.");
  }

  return safeParseJSON(text);
}

async function callVertex({
  apiKey,
  model,
  system,
  user,
  schema,
}: ProviderCallOptions) {
  if (apiKey.startsWith("AIza")) {
    return callGeminiStudio({ apiKey, model, system, user, schema });
  }

  if (looksLikeJwtCredential(apiKey)) {
    throw new Error(
      "VERTEX_API_KEY looks like an OIDC/JWT token, not a Google API key or OAuth access token. Use a Google Cloud API key for Gemini Enterprise Agent Platform, a Google AI Studio key that starts with AIza, or a Google OAuth access token.",
    );
  }

  if (looksLikeOAuthAccessToken(apiKey)) {
    return callVertexBearer({ apiKey, model, system, user, schema });
  }

  return callVertexApiKey({ apiKey, model, system, user, schema });
}

async function callVertexApiKey({
  apiKey,
  model,
  system,
  user,
  schema,
}: Omit<ProviderCallOptions, "provider">) {
  const url = `${VERTEX_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const data = await fetchWithTimeout<VertexResponse>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: 3500,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: toVertexSchema(schema),
      },
    }),
  });

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join("") || "";

  if (!text) {
    const reason = data.candidates?.[0]?.finishReason || "unknown";
    throw new Error(`Vertex returned no diagnostic result (${reason}).`);
  }

  return safeParseJSON(text);
}

async function callVertexBearer({
  apiKey,
  model,
  system,
  user,
  schema,
}: Omit<ProviderCallOptions, "provider">) {
  const url = `${VERTEX_API_BASE}/${model}:generateContent`;

  const data = await fetchWithTimeout<VertexResponse>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: 3500,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: toVertexSchema(schema),
      },
    }),
  });

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join("") || "";

  if (!text) {
    const reason = data.candidates?.[0]?.finishReason || "unknown";
    throw new Error(`Vertex returned no diagnostic result (${reason}).`);
  }

  return safeParseJSON(text);
}

async function callGeminiStudio({
  apiKey,
  model,
  system,
  user,
  schema,
}: Omit<ProviderCallOptions, "provider">) {
  const url = `${GEMINI_STUDIO_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const data = await fetchWithTimeout<VertexResponse>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: 3500,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: toVertexSchema(schema),
      },
    }),
  });

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join("") || "";

  if (!text) {
    const reason = data.candidates?.[0]?.finishReason || "unknown";
    throw new Error(`Gemini returned no diagnostic result (${reason}).`);
  }

  return safeParseJSON(text);
}

function looksLikeJwtCredential(apiKey: string) {
  return apiKey.startsWith("eyJ");
}

function looksLikeOAuthAccessToken(apiKey: string) {
  return apiKey.startsWith("ya29");
}

async function fetchWithTimeout<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Provider request failed (${response.status}): ${detail}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function toVertexSchema(schema: JsonSchema): JsonSchema {
  const output: JsonSchema = { type: schema.type.toUpperCase() };

  if (schema.required) {
    output.required = schema.required;
  }

  if (schema.enum) {
    output.enum = schema.enum;
  }

  if (schema.properties) {
    output.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        toVertexSchema(value),
      ]),
    );
  }

  if (schema.items) {
    output.items = toVertexSchema(schema.items);
  }

  return output;
}
