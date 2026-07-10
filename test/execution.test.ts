import { describe, expect, it } from "vitest";
import { normalizeExecutionAsset } from "../src/harness/execution";
import { workflowKeys } from "../src/harness/types";

describe("execution asset normalization", () => {
  it.each(workflowKeys)("keeps the routed workflow fixed for %s", (workflowKey) => {
    const result = normalizeExecutionAsset({
      runId: "diag_test",
      workflowKey,
      raw: {
        artifactType: "trust_packet",
        title: "Asset",
        content: "# Reviewable asset\n\nA manual founder action.",
        assumptions: ["Assumption"],
        risks: ["Risk"],
        unsupportedClaims: [],
        nextSteps: ["Review"],
        evaluation: { score: 120, recommendation: "approve" },
        approvalPrompt: "Approve this asset?",
      },
    });

    expect(result.workflowKey).toBe(workflowKey);
    expect(result.artifactType).toBe(workflowKey);
    expect(result.evaluation.score).toBe(100);
    expect(result.status).toBe("proposed");
  });

  it("rejects content that claims an external action already happened", () => {
    expect(() =>
      normalizeExecutionAsset({
        runId: "diag_test",
        workflowKey: "trust_packet",
        raw: {
          artifactType: "trust_packet",
          title: "Unsafe",
          content: "The email was sent to the buyer.",
          assumptions: [],
          risks: [],
          unsupportedClaims: [],
          nextSteps: [],
          evaluation: { score: 10, recommendation: "reject" },
          approvalPrompt: "Review",
        },
      }),
    ).toThrow("external action");
  });
});
