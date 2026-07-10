import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseExecutionRepository } from "../src/harness/executionRepository";
import { asset, diagnostic, intake } from "./fixtures";

describe("SupabaseExecutionRepository contract", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://supabase.test";
    process.env.SUPABASE_SECRET_KEY = "secret";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("stores, loads, scopes, and approves the same lifecycle as memory", async () => {
    const database = new FakeSupabase();
    vi.stubGlobal("fetch", database.fetch);
    const repository = new SupabaseExecutionRepository();

    await repository.saveDiagnostic("principal-a", intake, diagnostic());
    await repository.saveAsset("principal-a", asset());

    const loaded = await repository.getRun("principal-a", "diag_test_001");
    expect(loaded.assets).toHaveLength(1);
    await expect(repository.getRun("principal-b", "diag_test_001")).rejects.toThrow(
      "authenticated principal",
    );

    const approved = await repository.reviewAsset(
      "principal-a",
      "diag_test_001",
      "asset_test_001",
      "approve",
      "Ready",
    );
    expect(approved.status).toBe("approved");
  });
});

class FakeSupabase {
  private readonly tables = new Map<string, Array<Record<string, unknown>>>();

  fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").at(-1) || "";
    const rows = this.tables.get(table) || [];
    const method = init?.method || "GET";

    if (method === "POST") {
      const record = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (!rows.some((row) => row.id === record.id)) rows.push(record);
      this.tables.set(table, rows);
      return new Response(null, { status: 201 });
    }

    const matching = rows.filter((row) => matches(url, row));
    if (method === "PATCH") {
      const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
      matching.forEach((row) => Object.assign(row, patch));
      return new Response(null, { status: 204 });
    }

    if (method === "DELETE") {
      this.tables.set(
        table,
        rows.filter((row) => !matching.includes(row)),
      );
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify(matching), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function matches(url: URL, row: Record<string, unknown>) {
  for (const [field, value] of url.searchParams.entries()) {
    if (field === "select" || field === "order" || field === "on_conflict") continue;
    if (value.startsWith("eq.") && String(row[field]) !== value.slice(3)) return false;
  }
  return true;
}
