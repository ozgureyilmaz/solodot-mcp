import { describe, expect, it } from "vitest";
import {
  InMemoryExecutionRepository,
  RunNotFoundError,
} from "../src/harness/executionRepository";
import { asset, diagnostic, intake } from "./fixtures";

describe("InMemoryExecutionRepository", () => {
  it("isolates runs by principal and records approval transitions", async () => {
    const repository = new InMemoryExecutionRepository();
    await repository.saveDiagnostic("founder-a", intake, diagnostic());
    await repository.saveAsset("founder-a", asset());

    await expect(repository.getRun("founder-b", "diag_test_001")).rejects.toBeInstanceOf(
      RunNotFoundError,
    );

    const approved = await repository.reviewAsset(
      "founder-a",
      "diag_test_001",
      "asset_test_001",
      "approve",
      "Ready to use manually",
    );
    expect(approved.status).toBe("approved");

    const record = await repository.getRun("founder-a", "diag_test_001");
    expect(record.approvals).toHaveLength(1);
    expect(record.approvals[0].decision).toBe("approve");
  });
});
