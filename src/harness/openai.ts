import OpenAI from "openai";
import type { OpenAICallOptions } from "./types";
import { safeParseJSON } from "./validation";

export async function callStructuredOpenAI(
  { apiKey, model, system, user, schema }: OpenAICallOptions,
  outputName = "structured_result",
  outputDescription = "Emit the requested structured result.",
) {
  const client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2 });
  const response = await client.responses.create({
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    text: {
      format: {
        type: "json_schema",
        name: outputName,
        description: outputDescription,
        schema: strictJsonSchema(schema),
        strict: true,
      },
    },
  });
  if (!response.output_text) throw new Error("OpenAI returned no structured result.");
  return safeParseJSON(response.output_text);
}

function strictJsonSchema(schema: OpenAICallOptions["schema"]): Record<string, unknown> {
  const output: Record<string, unknown> = { ...schema };
  if (schema.type === "object") output.additionalProperties = false;
  if (schema.properties) {
    output.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, strictJsonSchema(value)]),
    );
  }
  if (schema.items) output.items = strictJsonSchema(schema.items);
  return output;
}

export function callDiagnosticOpenAI(options: OpenAICallOptions) {
  return callStructuredOpenAI(
    options,
    "diagnostic_result",
    "Emit the Solodot diagnostic harness result.",
  );
}
