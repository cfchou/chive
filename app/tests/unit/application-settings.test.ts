import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createApplicationSettingsRepository,
} from "../../src/lib/settings/application-settings";
import { createLocalStoragePersistence } from "../../src/lib/persistence/app-persistence";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("Application Settings Repository", () => {
  it("returns defaults when settings have not been persisted", async () => {
    const repository = createApplicationSettingsRepository(
      createLocalStoragePersistence(memoryStorage()),
    );

    assert.deepEqual(await repository.load(), {
      settings: {
        runtimeOverride: null,
        executableOverride: null,
      },
      status: "missing",
    });
  });

  it("round-trips current settings", async () => {
    const repository = createApplicationSettingsRepository(
      createLocalStoragePersistence(memoryStorage()),
    );
    const settings = {
      runtimeOverride: "codex" as const,
      executableOverride: {
        runtime: "codex" as const,
        path: "/opt/homebrew/bin/codex",
      },
    };

    assert.equal(await repository.save(settings), true);
    assert.deepEqual(await repository.load(), {
      settings,
      status: "current",
    });
  });

  it("returns defaults when current-version settings contain an invalid runtime", async () => {
    const storage = memoryStorage();
    storage.setItem(
      "chive.applicationSettings",
      JSON.stringify({
        version: 1,
        settings: {
          runtimeOverride: "gemini",
          executableOverride: null,
        },
      }),
    );
    const repository = createApplicationSettingsRepository(
      createLocalStoragePersistence(storage),
    );

    assert.deepEqual(await repository.load(), {
      settings: {
        runtimeOverride: null,
        executableOverride: null,
      },
      status: "invalid",
    });
  });

  it("preserves settings from an unsupported future version", async () => {
    const storage = memoryStorage();
    const futureSettings = JSON.stringify({
      version: 2,
      settings: {
        runtimeOverride: "codex",
        executableOverride: null,
        futureOption: true,
      },
    });
    storage.setItem("chive.applicationSettings", futureSettings);
    const repository = createApplicationSettingsRepository(
      createLocalStoragePersistence(storage),
    );

    assert.deepEqual(await repository.load(), {
      settings: {
        runtimeOverride: null,
        executableOverride: null,
      },
      status: "unsupported-version",
    });
    assert.equal(storage.getItem("chive.applicationSettings"), futureSettings);
  });

  it("serializes only versioned non-secret settings fields", async () => {
    const storage = memoryStorage();
    const repository = createApplicationSettingsRepository(
      createLocalStoragePersistence(storage),
    );
    const settings = {
      runtimeOverride: "codex" as const,
      executableOverride: {
        runtime: "codex" as const,
        path: "/usr/local/bin/codex",
        apiKey: "must-not-be-stored",
      },
      authenticationState: "must-not-be-stored",
    };

    assert.equal(await repository.save(settings), true);
    assert.deepEqual(
      JSON.parse(storage.getItem("chive.applicationSettings") ?? "null"),
      {
        version: 1,
        settings: {
          runtimeOverride: "codex",
          executableOverride: {
            runtime: "codex",
            path: "/usr/local/bin/codex",
          },
        },
      },
    );
  });

  it("persists an executable override without an explicit runtime override", async () => {
    const storage = memoryStorage();
    const repository = createApplicationSettingsRepository(
      createLocalStoragePersistence(storage),
    );

    assert.equal(
      await repository.save({
        runtimeOverride: null,
        executableOverride: {
          runtime: "codex",
          path: "/usr/local/bin/codex",
        },
      }),
      true,
    );
    assert.deepEqual(
      JSON.parse(storage.getItem("chive.applicationSettings") ?? "null"),
      {
        version: 1,
        settings: {
          runtimeOverride: null,
          executableOverride: {
            runtime: "codex",
            path: "/usr/local/bin/codex",
          },
        },
      },
    );
  });

  it("rejects an executable override for a different selected runtime", async () => {
    const storage = memoryStorage();
    const repository = createApplicationSettingsRepository(
      createLocalStoragePersistence(storage),
    );

    assert.equal(
      await repository.save({
        runtimeOverride: "opencode",
        executableOverride: {
          runtime: "codex",
          path: "/usr/local/bin/codex",
        },
      }),
      false,
    );
    assert.equal(storage.getItem("chive.applicationSettings"), null);
  });

  it("reports when settings cannot be persisted", async () => {
    const repository = createApplicationSettingsRepository(
      createLocalStoragePersistence(null),
    );

    assert.equal(
      await repository.save({
        runtimeOverride: null,
        executableOverride: null,
      }),
      false,
    );
  });
});
