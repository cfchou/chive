import { describe, expect, it } from "vitest";
import {
  createInMemoryRuntimeDiscovery,
  createTauriRuntimeDiscovery,
  resolveRuntimeSelection,
  type RuntimeDiscoveryReport,
} from "$lib/settings/runtime-discovery";

describe("runtime discovery", () => {
  it("uses built-in priority by RuntimeId instead of report position", () => {
    const report: RuntimeDiscoveryReport = {
      runtimes: [
        {
          status: "ready",
          runtime: "claude-code",
          executablePath: "/tools/claude",
          displayPath: "/tools/claude",
          version: "claude 3",
          source: "known-location",
        },
        {
          status: "ready",
          runtime: "opencode",
          executablePath: "/tools/opencode",
          displayPath: "/tools/opencode",
          version: "opencode 2",
          source: "known-location",
        },
        {
          status: "ready",
          runtime: "codex",
          executablePath: "/tools/codex",
          displayPath: "/tools/codex",
          version: "codex 1",
          source: "known-location",
        },
      ],
    };

    expect(
      resolveRuntimeSelection(
        { runtimeOverride: null, executableOverride: null },
        report,
      ),
    ).toMatchObject({
      runtime: "codex",
      source: "built-in-priority",
      ready: true,
    });
  });

  it("sends only the Executable Override and normalizes the native report", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const discovery = createTauriRuntimeDiscovery(async (command, args) => {
      calls.push({ command, args });
      return {
        runtimes: [
          {
            status: "unavailable",
            runtime: "claude-code",
            reason: "not-found",
          },
          {
            status: "unavailable",
            runtime: "codex",
            reason: "not-found",
          },
          {
            status: "ready",
            runtime: "opencode",
            executablePath: "/tools/opencode",
            displayPath: "/tools/opencode",
            version: "opencode 2",
            source: "known-location",
          },
        ],
      };
    });

    const report = await discovery.scan({ runtime: "opencode", path: "/tools/opencode" });

    expect(calls).toEqual([
      {
        command: "discover_runtimes",
        args: {
          request: {
            executableOverride: { runtime: "opencode", path: "/tools/opencode" },
          },
        },
      },
    ]);
    expect(report.runtimes.map((probe) => probe.runtime)).toEqual([
      "codex",
      "opencode",
      "claude-code",
    ]);
  });

  it("lets browser tests replace the in-memory discovery report", async () => {
    const discovery = createInMemoryRuntimeDiscovery();
    const readyCodex: RuntimeDiscoveryReport = {
      runtimes: [
        {
          status: "ready",
          runtime: "codex",
          executablePath: "/fixture/codex",
          displayPath: "/fixture/codex",
          version: "codex fixture",
          source: "known-location",
        },
        { status: "unavailable", runtime: "opencode", reason: "not-found" },
        { status: "unavailable", runtime: "claude-code", reason: "not-found" },
      ],
    };

    expect((await discovery.scan(null)).runtimes.every((probe) => probe.status === "unavailable")).toBe(
      true,
    );
    discovery.setReport(readyCodex);
    expect(await discovery.scan(null)).toEqual(readyCodex);
  });
});
