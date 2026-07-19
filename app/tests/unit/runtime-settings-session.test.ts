import { describe, expect, it } from "vitest";
import type {
  ApplicationSettings,
  ApplicationSettingsRepository,
} from "$lib/settings/application-settings";
import { createInMemoryRuntimeDiscovery } from "$lib/settings/runtime-discovery";
import type { RuntimeDiscovery, RuntimeDiscoveryReport } from "$lib/settings/runtime-discovery";
import { createRuntimeSettingsSession } from "$lib/settings/runtime-settings-session.svelte";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function repositoryWith(settings: ApplicationSettings): ApplicationSettingsRepository {
  return {
    async load() {
      return { settings, status: "current" };
    },
    async save() {
      return true;
    },
  };
}

function readyCodex(version: string): RuntimeDiscoveryReport {
  return {
    runtimes: [
      {
        status: "ready",
        runtime: "codex",
        executablePath: "/custom/codex",
        displayPath: "/custom/codex",
        version,
        source: "executable-override",
      },
      { status: "unavailable", runtime: "opencode", reason: "not-found" },
      { status: "unavailable", runtime: "claude-code", reason: "not-found" },
    ],
  };
}

describe("Runtime Settings session", () => {
  it("clears a differently-associated Executable Override when the runtime changes", async () => {
    const session = createRuntimeSettingsSession({
      repository: repositoryWith({
        runtimeOverride: "codex",
        executableOverride: { runtime: "codex", path: "/custom/codex" },
      }),
      discovery: createInMemoryRuntimeDiscovery(),
    });
    await session.initialize();
    session.open();

    expect(session.updateDraft({ type: "set-runtime-override", runtime: "opencode" })).toBe(true);
    expect(session.draftSettings).toEqual({
      runtimeOverride: "opencode",
      executableOverride: null,
    });
  });

  it("rescans the draft Executable Override without saving it", async () => {
    const scanInputs: ApplicationSettings["executableOverride"][] = [];
    const saved: ApplicationSettings[] = [];
    const discovery: RuntimeDiscovery = {
      async scan(executableOverride) {
        scanInputs.push(executableOverride);
        return readyCodex(executableOverride?.path ?? "automatic");
      },
    };
    const session = createRuntimeSettingsSession({
      repository: {
        async load() {
          return { settings: { runtimeOverride: null, executableOverride: null }, status: "missing" };
        },
        async save(settings) {
          saved.push(settings);
          return true;
        },
      },
      discovery,
    });
    await session.initialize();
    session.open();
    session.updateDraft({
      type: "set-executable-override",
      runtime: "codex",
      path: "/draft/codex",
    });

    await session.rescan();

    expect(scanInputs).toEqual([null, { runtime: "codex", path: "/draft/codex" }]);
    expect(session.draftReport.runtimes[0]).toMatchObject({
      status: "ready",
      version: "/draft/codex",
    });
    expect(saved).toEqual([]);
  });

  it("saves a runtime-only change without repeating a matching discovery scan", async () => {
    let scanCount = 0;
    const saved: ApplicationSettings[] = [];
    const session = createRuntimeSettingsSession({
      repository: {
        async load() {
          return { settings: { runtimeOverride: null, executableOverride: null }, status: "missing" };
        },
        async save(settings) {
          saved.push(settings);
          return true;
        },
      },
      discovery: {
        async scan() {
          scanCount += 1;
          return readyCodex("codex 1");
        },
      },
    });
    await session.initialize();
    session.open();
    session.updateDraft({ type: "set-runtime-override", runtime: "codex" });

    expect(await session.save()).toBe(true);
    expect(saved).toEqual([{ runtimeOverride: "codex", executableOverride: null }]);
    expect(session.committedSettings).toEqual({
      runtimeOverride: "codex",
      executableOverride: null,
    });
    expect(scanCount).toBe(1);
  });

  it("finishes Save while an unmatched committed scan continues in the background", async () => {
    const backgroundReport = deferred<RuntimeDiscoveryReport>();
    const scanInputs: ApplicationSettings["executableOverride"][] = [];
    const session = createRuntimeSettingsSession({
      repository: repositoryWith({ runtimeOverride: null, executableOverride: null }),
      discovery: {
        async scan(executableOverride) {
          scanInputs.push(executableOverride);
          if (scanInputs.length === 1) return readyCodex("initial");
          return backgroundReport.promise;
        },
      },
    });
    await session.initialize();
    session.open();
    session.updateDraft({
      type: "set-executable-override",
      runtime: "codex",
      path: "/new/codex",
    });

    const savePromise = session.save();
    await Promise.resolve();
    await Promise.resolve();

    expect(session.saving).toBe(false);
    await expect(savePromise).resolves.toBe(true);
    expect(scanInputs).toEqual([null, { runtime: "codex", path: "/new/codex" }]);

    backgroundReport.resolve(readyCodex("rescanned"));
    await Promise.resolve();
  });

  it("keeps Settings usable when the initial scan fails", async () => {
    const session = createRuntimeSettingsSession({
      repository: repositoryWith({ runtimeOverride: null, executableOverride: null }),
      discovery: {
        async scan() {
          throw new Error("native scan failed");
        },
      },
    });

    await expect(session.initialize()).resolves.toBeUndefined();
    expect(session.scanError).toBe("Runtime scan failed. Try Rescan.");
    expect(session.committedReport.runtimes.every((probe) => probe.status === "unavailable")).toBe(
      true,
    );
  });

  it("ignores a stale Rescan result", async () => {
    const first = deferred<RuntimeDiscoveryReport>();
    const second = deferred<RuntimeDiscoveryReport>();
    let scanCount = 0;
    const session = createRuntimeSettingsSession({
      repository: repositoryWith({ runtimeOverride: null, executableOverride: null }),
      discovery: {
        async scan() {
          scanCount += 1;
          if (scanCount === 1) return readyCodex("initial");
          return scanCount === 2 ? first.promise : second.promise;
        },
      },
    });
    await session.initialize();
    session.open();

    const staleScan = session.rescan();
    const latestScan = session.rescan();
    second.resolve(readyCodex("latest"));
    await latestScan;
    first.resolve(readyCodex("stale"));
    await staleScan;

    expect(session.draftReport.runtimes[0]).toMatchObject({ version: "latest" });
  });

  it("keeps the draft after a Save failure", async () => {
    const session = createRuntimeSettingsSession({
      repository: {
        async load() {
          return { settings: { runtimeOverride: null, executableOverride: null }, status: "current" };
        },
        async save() {
          return false;
        },
      },
      discovery: createInMemoryRuntimeDiscovery(readyCodex("initial")),
    });
    await session.initialize();
    session.open();
    session.updateDraft({ type: "set-runtime-override", runtime: "codex" });

    expect(await session.save()).toBe(false);
    expect(session.draftSettings.runtimeOverride).toBe("codex");
    expect(session.committedSettings.runtimeOverride).toBeNull();
    expect(session.saveError).toBe("Settings could not be saved.");
  });
});
