import { describe, expect, it } from "vitest";
import {
  authenticateBearer,
  configuredApiKeys,
  McpAuthenticationError,
} from "../src/auth";

describe("remote bearer authentication", () => {
  it("accepts only an allowlisted token", () => {
    expect(authenticateBearer("Bearer secret-a", ["secret-a", "secret-b"])).toBe(
      "secret-a",
    );
    expect(() => authenticateBearer("Bearer wrong", ["secret-a"])).toThrow(
      McpAuthenticationError,
    );
  });

  it("parses a comma-separated key list", () => {
    expect(configuredApiKeys("one, two ,,three")).toEqual(["one", "two", "three"]);
  });
});
