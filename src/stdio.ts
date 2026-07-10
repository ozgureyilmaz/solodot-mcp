#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  InMemoryExecutionRepository,
  SupabaseExecutionRepository,
} from "./harness/executionRepository";
import { getRunPersistenceConfig } from "./harness/persistence";
import { createSolodotMcpServer } from "./server";

const repository = getRunPersistenceConfig()
  ? new SupabaseExecutionRepository()
  : new InMemoryExecutionRepository();
const principal = process.env.SOLODOT_LOCAL_PRINCIPAL || "local-stdio";
const server = createSolodotMcpServer({ repository, principal });

await server.connect(new StdioServerTransport());

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});
