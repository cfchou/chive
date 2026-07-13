import { describe, expect, it } from "vitest";
import { DEFAULT_COVERAGE_PORT, DEFAULT_E2E_PORT, resolvePorts } from "../../scripts/dev-ports.mjs";

describe("resolvePorts", () => {
  it("keeps the historical defaults when nothing is set", () => {
    expect(resolvePorts({})).toEqual({ e2ePort: 1430, coveragePort: 1432, hmrPort: 1431 });
    expect(DEFAULT_E2E_PORT).toBe(1430);
    expect(DEFAULT_COVERAGE_PORT).toBe(1432);
  });

  it("treats empty variables as unset", () => {
    expect(resolvePorts({ CHIVE_E2E_PORT: "", CHIVE_COVERAGE_PORT: "" })).toEqual({
      e2ePort: 1430,
      coveragePort: 1432,
      hmrPort: 1431,
    });
  });

  it("honors explicit overrides and derives HMR as e2e + 1", () => {
    expect(resolvePorts({ CHIVE_E2E_PORT: "1450", CHIVE_COVERAGE_PORT: "1452" })).toEqual({
      e2ePort: 1450,
      coveragePort: 1452,
      hmrPort: 1451,
    });
  });

  it("allows overriding just one port", () => {
    expect(resolvePorts({ CHIVE_E2E_PORT: "1440" })).toEqual({
      e2ePort: 1440,
      coveragePort: 1432,
      hmrPort: 1441,
    });
    expect(resolvePorts({ CHIVE_COVERAGE_PORT: "1442" })).toEqual({
      e2ePort: 1430,
      coveragePort: 1442,
      hmrPort: 1431,
    });
  });

  it.each([
    ["not a number", "vite"],
    ["a float", "1430.5"],
    ["negative", "-1"],
    ["a privileged port", "80"],
    ["above the range that leaves room for HMR", "65535"],
  ])("rejects a value that is %s with the variable name in the message", (_label, raw) => {
    expect(() => resolvePorts({ CHIVE_E2E_PORT: raw })).toThrow(/CHIVE_E2E_PORT/);
    expect(() => resolvePorts({ CHIVE_COVERAGE_PORT: raw })).toThrow(/CHIVE_COVERAGE_PORT/);
  });

  it("rejects a coverage port that collides with the e2e port", () => {
    expect(() => resolvePorts({ CHIVE_E2E_PORT: "1440", CHIVE_COVERAGE_PORT: "1440" })).toThrow(
      /collides with CHIVE_E2E_PORT/,
    );
  });

  it("rejects a coverage port that collides with the HMR port", () => {
    expect(() => resolvePorts({ CHIVE_E2E_PORT: "1440", CHIVE_COVERAGE_PORT: "1441" })).toThrow(/HMR/);
  });

  it("rejects the defaults colliding with an override", () => {
    expect(() => resolvePorts({ CHIVE_E2E_PORT: "1432" })).toThrow(/collides/);
    expect(() => resolvePorts({ CHIVE_COVERAGE_PORT: "1430" })).toThrow(/collides/);
    expect(() => resolvePorts({ CHIVE_COVERAGE_PORT: "1431" })).toThrow(/HMR/);
  });
});
