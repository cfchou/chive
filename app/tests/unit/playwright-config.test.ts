import { describe, expect, it } from "vitest";
import { resolvePlaywrightRetries } from "../../playwright.config";

describe("resolvePlaywrightRetries", () => {
  it("retries only instrumented browser tests running in CI", () => {
    expect(resolvePlaywrightRetries({ CI: "true", VITE_COVERAGE: "true" })).toBe(1);
    expect(resolvePlaywrightRetries({ CI: "false", VITE_COVERAGE: "true" })).toBe(0);
    expect(resolvePlaywrightRetries({ CI: "true" })).toBe(0);
    expect(resolvePlaywrightRetries({ VITE_COVERAGE: "true" })).toBe(0);
    expect(resolvePlaywrightRetries({})).toBe(0);
  });
});
