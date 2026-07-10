import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryExecutionRepository } from "../src/harness/executionRepository";
import { createSolodotMcpServer } from "../src/server";
import { asset, diagnostic } from "./fixtures";

describe("Solodot MCP lifecycle", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("routes, generates, revises, regenerates, approves, and exports", async () => {
    const repository = new InMemoryExecutionRepository();
    let generated = 0;
    const server = createSolodotMcpServer({
      repository,
      principal: "founder-a",
      route: async () => diagnostic(),
      execute: async () => ({
        ...asset(),
        assetId: `asset_test_${++generated}`,
      }),
    });
    const client = new Client({ name: "solodot-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    closers.push(() => client.close(), () => server.close());

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "route_painpoint",
        "generate_execution_asset",
        "review_execution_asset",
        "get_solodot_run",
        "export_solodot_run",
      ]),
    );

    await client.callTool({
      name: "route_painpoint",
      arguments: {
        founderType: "Solo founder",
        stage: "Prototype",
        offer: "Workflow tool",
        bottleneck: "No customer motion",
        recentAttempt: "Generic launch",
        weeklyConstraint: "Ten hours",
      },
    });

    const first = await client.callTool({
      name: "generate_execution_asset",
      arguments: { runId: "diag_test_001" },
    });
    expect(first.isError).not.toBe(true);

    await client.callTool({
      name: "review_execution_asset",
      arguments: {
        runId: "diag_test_001",
        assetId: "asset_test_1",
        decision: "revise",
        reason: "Narrow the buyer",
      },
    });
    await client.callTool({
      name: "generate_execution_asset",
      arguments: {
        runId: "diag_test_001",
        corrections: "Focus on bootstrapped B2B SaaS founders",
      },
    });
    await client.callTool({
      name: "review_execution_asset",
      arguments: {
        runId: "diag_test_001",
        assetId: "asset_test_2",
        decision: "approve",
      },
    });

    const exported = await client.callTool({
      name: "export_solodot_run",
      arguments: { runId: "diag_test_001", format: "markdown" },
    });
    expect(exported.isError).not.toBe(true);
    expect(JSON.stringify(exported.structuredContent)).toContain(
      "No external action was performed",
    );
  });

  it("refuses export until an asset is approved", async () => {
    const repository = new InMemoryExecutionRepository();
    await repository.saveDiagnostic(
      "founder-a",
      {
        provider: "anthropic",
        founderType: "Solo founder",
        stage: "Prototype",
        offer: "Tool",
        customerContext: "",
        bottleneck: "No customers",
        recentAttempt: "Launch",
        weeklyConstraint: "Ten hours",
        trustBlocker: "",
        validationEvidence: "",
        criticalAssumption: "",
      },
      diagnostic(),
    );
    await repository.saveAsset("founder-a", asset());
    const server = createSolodotMcpServer({ repository, principal: "founder-a" });
    const client = new Client({ name: "solodot-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    closers.push(() => client.close(), () => server.close());

    const result = await client.callTool({
      name: "export_solodot_run",
      arguments: { runId: "diag_test_001", format: "json" },
    });
    expect(result.isError).toBe(true);
  });
});
