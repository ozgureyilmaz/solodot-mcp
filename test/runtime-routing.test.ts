import { describe, expect, it } from "vitest";
import { routeExecutionPack } from "../src/runtime/routing";

describe("adaptive runtime routing", () => {
  it("uses Advisor when work is singular or sequential", () => {
    expect(routeExecutionPack("bottleneck_map", 12).mode).toBe("advisor");
    expect(routeExecutionPack("customer_learning_loop", 12).mode).toBe("advisor");
  });

  it("uses Orchestrator for useful independent work", () => {
    expect(routeExecutionPack("first_customer_pipeline", 12)).toMatchObject({
      mode: "orchestrator",
      workerCount: 3,
    });
  });

  it("bounds a wave by configuration rather than a hard-coded two-worker limit", () => {
    expect(routeExecutionPack("first_customer_pipeline", 2).workerCount).toBe(2);
    expect(routeExecutionPack("first_customer_pipeline", 12).workerCount).toBe(3);
  });
});
