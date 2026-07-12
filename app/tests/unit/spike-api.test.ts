import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { installSpikeDebugApi, type SpikeDebugApi, type SpikeDebugTarget } from "../../src/lib/debug/spike-api";

describe("spike debug api installer", () => {
  it("installs the api on the target and removes it on teardown", () => {
    const target: SpikeDebugTarget & { other?: string } = { other: "untouched" };
    const api = { stats: () => ({}) } as unknown as SpikeDebugApi;
    const teardown = installSpikeDebugApi(target, api);
    assert.equal(target.__pdfSpike, api);
    teardown();
    assert.equal("__pdfSpike" in target, false);
    assert.equal(target.other, "untouched");
    assert.doesNotThrow(teardown);
  });
});
