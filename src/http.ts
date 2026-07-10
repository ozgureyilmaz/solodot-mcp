#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SupabaseExecutionRepository } from "./harness/executionRepository";
import {
  authenticateBearer,
  configuredApiKeys,
  McpAuthenticationError,
} from "./auth";
import { createSolodotMcpServer } from "./server";

const apiKeys = configuredApiKeys();
if (apiKeys.length === 0) {
  throw new Error("Remote MCP requires at least one SOLODOT_MCP_API_KEYS value.");
}
const repository = new SupabaseExecutionRepository();
const port = parsePort(process.env.PORT);
const host = process.env.HOST || "0.0.0.0";

const httpServer = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, { ok: true, service: "solodot-mcp" });
    }
    if (request.url !== "/mcp") {
      return json(response, 404, { error: "Not found" });
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return json(response, 405, { error: "Method not allowed" });
    }

    const principal = authenticateBearer(request.headers.authorization, apiKeys);
    const body = await readJsonBody(request);
    const server = createSolodotMcpServer({ repository, principal });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    response.on("close", () => {
      void server.close();
    });
    await transport.handleRequest(request, response, body);
  } catch (error) {
    if (response.headersSent) return;
    if (error instanceof McpAuthenticationError) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="solodot-mcp"');
      return json(response, 401, { error: error.message });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return json(response, 500, { error: "Solodot MCP request failed.", detail: message });
  }
});

httpServer.listen(port, host, () => {
  process.stderr.write(`Solodot MCP listening on http://${host}:${port}/mcp\n`);
});

process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});

async function readJsonBody(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 1_000_000) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : undefined;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function parsePort(value: string | undefined) {
  const port = Number(value || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }
  return port;
}
