import { invoke } from "@tauri-apps/api/core";
import type { ApplicationSettings, RuntimeId } from "./application-settings";

export type RuntimeSource =
  | "executable-override"
  | "inherited-path"
  | "known-location"
  | "codex-app-bundle";

export type RuntimeProbe =
  | {
      status: "ready";
      runtime: RuntimeId;
      executablePath: string;
      displayPath: string;
      version: string;
      source: RuntimeSource;
    }
  | {
      status: "unavailable";
      runtime: RuntimeId;
      reason:
        | "not-found"
        | "override-not-absolute"
        | "path-not-found"
        | "path-not-file"
        | "path-not-executable"
        | "probe-timeout"
        | "scan-budget-exhausted"
        | "probe-failed"
        | "version-unreadable";
      displayPath?: string;
      source?: RuntimeSource;
    };

export type RuntimeDiscoveryReport = {
  runtimes: readonly RuntimeProbe[];
};

export type RuntimeSelection =
  | {
      runtime: RuntimeId;
      source: "runtime-override" | "built-in-priority";
      ready: boolean;
      probe: RuntimeProbe;
    }
  | {
      runtime: null;
      source: "none";
      ready: false;
      probe: null;
    };

const RUNTIME_PRIORITY: readonly RuntimeId[] = ["codex", "opencode", "claude-code"];
const RUNTIME_SOURCES: readonly RuntimeSource[] = [
  "executable-override",
  "inherited-path",
  "known-location",
  "codex-app-bundle",
];
const UNAVAILABLE_REASONS: readonly Extract<RuntimeProbe, { status: "unavailable" }>["reason"][] = [
  "not-found",
  "override-not-absolute",
  "path-not-found",
  "path-not-file",
  "path-not-executable",
  "probe-timeout",
  "scan-budget-exhausted",
  "probe-failed",
  "version-unreadable",
];

export type RuntimeDiscovery = {
  scan(
    executableOverride: ApplicationSettings["executableOverride"],
  ): Promise<RuntimeDiscoveryReport>;
};

export type InMemoryRuntimeDiscovery = RuntimeDiscovery & {
  setReport(report: RuntimeDiscoveryReport): void;
};

export function emptyRuntimeDiscoveryReport(): RuntimeDiscoveryReport {
  return {
    runtimes: RUNTIME_PRIORITY.map((runtime) => ({
      status: "unavailable" as const,
      runtime,
      reason: "not-found" as const,
    })),
  };
}

export function createInMemoryRuntimeDiscovery(
  initialReport: RuntimeDiscoveryReport = emptyRuntimeDiscoveryReport(),
): InMemoryRuntimeDiscovery {
  let report = parseRuntimeDiscoveryReport(initialReport);
  return {
    async scan() {
      return report;
    },
    setReport(nextReport) {
      report = parseRuntimeDiscoveryReport(nextReport);
    },
  };
}

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function createTauriRuntimeDiscovery(
  invokeCommand: InvokeCommand = (command, args) => invoke(command, args),
): RuntimeDiscovery {
  return {
    async scan(executableOverride) {
      const value = await invokeCommand("discover_runtimes", {
        request: { executableOverride },
      });
      return parseRuntimeDiscoveryReport(value);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRuntimeId(value: unknown): value is RuntimeId {
  return typeof value === "string" && RUNTIME_PRIORITY.includes(value as RuntimeId);
}

function isRuntimeSource(value: unknown): value is RuntimeSource {
  return typeof value === "string" && RUNTIME_SOURCES.includes(value as RuntimeSource);
}

function parseRuntimeProbe(value: unknown): RuntimeProbe | null {
  if (!isRecord(value) || !isRuntimeId(value.runtime)) return null;
  if (value.status === "ready") {
    if (
      typeof value.executablePath !== "string" ||
      typeof value.displayPath !== "string" ||
      typeof value.version !== "string" ||
      !isRuntimeSource(value.source)
    ) {
      return null;
    }
    return {
      status: "ready",
      runtime: value.runtime,
      executablePath: value.executablePath,
      displayPath: value.displayPath,
      version: value.version,
      source: value.source,
    };
  }
  if (
    value.status !== "unavailable" ||
    typeof value.reason !== "string" ||
    !UNAVAILABLE_REASONS.includes(
      value.reason as Extract<RuntimeProbe, { status: "unavailable" }>["reason"],
    ) ||
    (value.displayPath !== undefined && typeof value.displayPath !== "string") ||
    (value.source !== undefined && !isRuntimeSource(value.source))
  ) {
    return null;
  }
  return {
    status: "unavailable",
    runtime: value.runtime,
    reason: value.reason as Extract<RuntimeProbe, { status: "unavailable" }>["reason"],
    ...(value.displayPath === undefined ? {} : { displayPath: value.displayPath }),
    ...(value.source === undefined ? {} : { source: value.source }),
  };
}

export function parseRuntimeDiscoveryReport(value: unknown): RuntimeDiscoveryReport {
  if (!isRecord(value) || !Array.isArray(value.runtimes)) {
    throw new Error("Invalid runtime discovery report");
  }
  const probes = value.runtimes.map(parseRuntimeProbe);
  if (probes.some((probe) => probe === null)) {
    throw new Error("Invalid runtime discovery report");
  }
  const byRuntime = new Map((probes as RuntimeProbe[]).map((probe) => [probe.runtime, probe]));
  if (byRuntime.size !== RUNTIME_PRIORITY.length || probes.length !== RUNTIME_PRIORITY.length) {
    throw new Error("Invalid runtime discovery report");
  }
  return {
    runtimes: RUNTIME_PRIORITY.map((runtime) => {
      const probe = byRuntime.get(runtime);
      if (!probe) throw new Error("Invalid runtime discovery report");
      return probe;
    }),
  };
}

export function resolveRuntimeSelection(
  settings: ApplicationSettings,
  report: RuntimeDiscoveryReport,
): RuntimeSelection {
  const probes = new Map(report.runtimes.map((probe) => [probe.runtime, probe]));
  if (settings.runtimeOverride !== null) {
    const probe = probes.get(settings.runtimeOverride);
    if (!probe) return { runtime: null, source: "none", ready: false, probe: null };
    return {
      runtime: settings.runtimeOverride,
      source: "runtime-override",
      ready: probe.status === "ready",
      probe,
    };
  }

  for (const runtime of RUNTIME_PRIORITY) {
    const probe = probes.get(runtime);
    if (probe?.status === "ready") {
      return { runtime, source: "built-in-priority", ready: true, probe };
    }
  }
  return { runtime: null, source: "none", ready: false, probe: null };
}
