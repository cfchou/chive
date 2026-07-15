import type { AppPersistence } from "$lib/persistence/app-persistence";

const APPLICATION_SETTINGS_KEY = "chive.applicationSettings";

export type RuntimeId = "codex" | "opencode" | "claude-code";

export type ApplicationSettings = {
  runtimeOverride: RuntimeId | null;
  executableOverride: {
    runtime: RuntimeId;
    path: string;
  } | null;
};

export type ApplicationSettingsLoadResult = {
  settings: ApplicationSettings;
  status: "current" | "missing" | "invalid" | "unsupported-version";
};

export type ApplicationSettingsRepository = {
  load(): Promise<ApplicationSettingsLoadResult>;
  save(settings: ApplicationSettings): Promise<boolean>;
};

type PersistedApplicationSettingsV1 = {
  version: 1;
  settings: ApplicationSettings;
};

const DEFAULT_APPLICATION_SETTINGS: ApplicationSettings = {
  runtimeOverride: null,
  executableOverride: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRuntimeId(value: unknown): value is RuntimeId {
  return value === "codex" || value === "opencode" || value === "claude-code";
}

function parseApplicationSettings(value: unknown): ApplicationSettings | null {
  if (!isRecord(value)) return null;

  const runtimeOverride = value.runtimeOverride;
  if (runtimeOverride !== null && !isRuntimeId(runtimeOverride)) return null;

  const executableOverride = value.executableOverride;
  if (executableOverride === null) {
    return { runtimeOverride, executableOverride: null };
  }
  if (
    !isRecord(executableOverride) ||
    !isRuntimeId(executableOverride.runtime) ||
    typeof executableOverride.path !== "string" ||
    executableOverride.path.trim().length === 0 ||
    (runtimeOverride !== null && executableOverride.runtime !== runtimeOverride)
  ) {
    return null;
  }

  return {
    runtimeOverride,
    executableOverride: {
      runtime: executableOverride.runtime,
      path: executableOverride.path,
    },
  };
}

function defaultLoadResult(
  status: Exclude<ApplicationSettingsLoadResult["status"], "current">,
): ApplicationSettingsLoadResult {
  return {
    settings: { ...DEFAULT_APPLICATION_SETTINGS },
    status,
  };
}

function loadPersistedApplicationSettings(persisted: unknown): ApplicationSettingsLoadResult {
  if (!isRecord(persisted) || typeof persisted.version !== "number") {
    return defaultLoadResult("invalid");
  }

  // Add one case per supported historical version. Each case owns validation
  // of that version and its deterministic migration to ApplicationSettings.
  switch (persisted.version) {
    case 1: {
      const settings = parseApplicationSettings(persisted.settings);
      return settings
        ? { settings, status: "current" }
        : defaultLoadResult("invalid");
    }
    default:
      return defaultLoadResult("unsupported-version");
  }
}

export function createApplicationSettingsRepository(
  persistence: AppPersistence,
): ApplicationSettingsRepository {
  return {
    async load(): Promise<ApplicationSettingsLoadResult> {
      const persisted = await persistence.getJson<unknown>(APPLICATION_SETTINGS_KEY);
      if (persisted === null) {
        return defaultLoadResult("missing");
      }
      return loadPersistedApplicationSettings(persisted);
    },

    async save(settings: ApplicationSettings): Promise<boolean> {
      const serializableSettings = parseApplicationSettings(settings);
      if (!serializableSettings) return false;
      const persisted: PersistedApplicationSettingsV1 = {
        version: 1,
        settings: serializableSettings,
      };
      return persistence.setJson(APPLICATION_SETTINGS_KEY, persisted);
    },
  };
}
