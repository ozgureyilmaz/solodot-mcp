import { describe, expect, it } from "vitest";
import { parseDiagnosticIntake } from "../src/harness/validation";
import { intake } from "./fixtures";

describe("OpenAI-only public contract", () => {
  it("does not accept a browser-selected model provider", () => {
    expect(parseDiagnosticIntake({ ...intake, provider: "untrusted" })).toEqual(intake);
  });
});
