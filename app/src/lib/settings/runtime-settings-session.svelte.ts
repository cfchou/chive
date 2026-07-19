// This session keeps saved settings and the open modal's draft separate. Settings and
// discovery reports also have separate change counters because a Rescan changes the report,
// not what the user has entered. Scan IDs keep slower, older requests from winning, while the
// saved report input records which Executable Override produced each report.

import type {
  ApplicationSettings,
  ApplicationSettingsLoadResult,
  ApplicationSettingsRepository,
  RuntimeId,
} from "./application-settings";
import {
  emptyRuntimeDiscoveryReport,
  resolveRuntimeSelection,
  type RuntimeDiscovery,
  type RuntimeDiscoveryReport,
} from "./runtime-discovery";

export type RuntimeSettingsDraftAction =
  | { type: "set-runtime-override"; runtime: RuntimeId | null }
  | { type: "set-executable-override"; runtime: RuntimeId; path: string }
  | { type: "clear-executable-override" };

type RuntimeSettingsSessionDependencies = {
  repository: ApplicationSettingsRepository;
  discovery: RuntimeDiscovery;
};

const DEFAULT_SETTINGS: ApplicationSettings = {
  runtimeOverride: null,
  executableOverride: null,
};

function copySettings(settings: ApplicationSettings): ApplicationSettings {
  return {
    runtimeOverride: settings.runtimeOverride,
    executableOverride:
      settings.executableOverride === null ? null : { ...settings.executableOverride },
  };
}

function copyExecutableOverride(
  executableOverride: ApplicationSettings["executableOverride"],
): ApplicationSettings["executableOverride"] {
  return executableOverride === null ? null : { ...executableOverride };
}

function sameExecutableOverride(
  left: ApplicationSettings["executableOverride"],
  right: ApplicationSettings["executableOverride"],
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.runtime === right.runtime &&
      left.path === right.path)
  );
}

function sameSettings(left: ApplicationSettings, right: ApplicationSettings): boolean {
  return (
    left.runtimeOverride === right.runtimeOverride &&
    sameExecutableOverride(left.executableOverride, right.executableOverride)
  );
}

export function createRuntimeSettingsSession({
  repository,
  discovery,
}: RuntimeSettingsSessionDependencies) {
  let initialized = false;
  let committedSettings = $state<ApplicationSettings>(copySettings(DEFAULT_SETTINGS));
  let draftSettings = $state<ApplicationSettings>(copySettings(DEFAULT_SETTINGS));
  let loadStatus = $state<ApplicationSettingsLoadResult["status"]>("missing");
  let committedReport = $state<RuntimeDiscoveryReport>(emptyRuntimeDiscoveryReport());
  let draftReport = $state<RuntimeDiscoveryReport>(emptyRuntimeDiscoveryReport());
  let committedReportInput = $state<ApplicationSettings["executableOverride"]>(null);
  let draftReportInput = $state<ApplicationSettings["executableOverride"]>(null);
  // Startup runs in the background. These counters let it fill untouched state without
  // replacing newer settings or a newer report in the modal.
  let draftSettingsRevision = 0;
  let draftReportRevision = 0;
  let draftScanId = 0;
  let committedScanId = 0;
  let scanning = $state(false);
  let saving = $state(false);
  let scanError = $state<string | null>(null);
  let saveError = $state<string | null>(null);

  function replaceDraftSettings(nextSettings: ApplicationSettings): void {
    const reportInputChanged = !sameExecutableOverride(
      draftSettings.executableOverride,
      nextSettings.executableOverride,
    );
    draftSettings = nextSettings;
    draftSettingsRevision += 1;
    if (reportInputChanged) draftReportRevision += 1;
  }

  async function scanCommitted(input: ApplicationSettings["executableOverride"]): Promise<void> {
    const scanId = ++committedScanId;
    try {
      const report = await discovery.scan(input);
      if (scanId !== committedScanId) return;
      committedReport = report;
      committedReportInput = copyExecutableOverride(input);
      scanError = null;
    } catch {
      if (scanId === committedScanId) scanError = "Runtime scan failed. Try Rescan.";
    }
  }

  return {
    get committedSettings() {
      return committedSettings;
    },
    get draftSettings() {
      return draftSettings;
    },
    get loadStatus() {
      return loadStatus;
    },
    get committedReport() {
      return committedReport;
    },
    get draftReport() {
      return draftReport;
    },
    get scanning() {
      return scanning;
    },
    get scanError() {
      return scanError;
    },
    get draftSelection() {
      return resolveRuntimeSelection(draftSettings, draftReport);
    },
    get committedSelection() {
      return resolveRuntimeSelection(committedSettings, committedReport);
    },
    get dirty() {
      return !sameSettings(draftSettings, committedSettings);
    },
    get saving() {
      return saving;
    },
    get saveBlocked() {
      return loadStatus === "unsupported-version";
    },
    get saveError() {
      return saveError;
    },
    async initialize() {
      if (initialized) return;
      initialized = true;
      const untouchedDraftSettingsRevision = draftSettingsRevision;
      const untouchedDraftReportRevision = draftReportRevision;
      const loaded = await repository.load();
      loadStatus = loaded.status;
      committedSettings = copySettings(loaded.settings);
      if (draftSettingsRevision === untouchedDraftSettingsRevision) {
        draftSettings = copySettings(loaded.settings);
      }
      // A failed probe must not stop the user from opening Settings and correcting the path.
      await scanCommitted(copyExecutableOverride(committedSettings.executableOverride));
      if (draftReportRevision === untouchedDraftReportRevision) {
        draftReport = committedReport;
        draftReportInput = copyExecutableOverride(committedReportInput);
      }
    },
    open() {
      draftSettings = copySettings(committedSettings);
      draftReport = committedReport;
      draftReportInput = copyExecutableOverride(committedReportInput);
      saveError = null;
    },
    updateDraft(action: RuntimeSettingsDraftAction): boolean {
      if (action.type === "set-runtime-override") {
        const executableOverride = draftSettings.executableOverride;
        replaceDraftSettings({
          runtimeOverride: action.runtime,
          executableOverride:
            action.runtime !== null &&
            executableOverride !== null &&
            executableOverride.runtime !== action.runtime
              ? null
              : executableOverride,
        });
        return true;
      }
      if (action.type === "clear-executable-override" || action.path.trim().length === 0) {
        replaceDraftSettings({ ...draftSettings, executableOverride: null });
        return true;
      }
      if (
        draftSettings.runtimeOverride !== null &&
        draftSettings.runtimeOverride !== action.runtime
      ) {
        return false;
      }
      replaceDraftSettings({
        ...draftSettings,
        executableOverride: { runtime: action.runtime, path: action.path },
      });
      return true;
    },
    async rescan() {
      draftReportRevision += 1;
      const scanId = ++draftScanId;
      const input = copyExecutableOverride(draftSettings.executableOverride);
      scanning = true;
      scanError = null;
      try {
        const report = await discovery.scan(input);
        if (
          scanId !== draftScanId ||
          !sameExecutableOverride(input, draftSettings.executableOverride)
        ) {
          return;
        }
        draftReport = report;
        draftReportInput = input;
      } catch {
        if (
          scanId === draftScanId &&
          sameExecutableOverride(input, draftSettings.executableOverride)
        ) {
          scanError = "Runtime scan failed. Try Rescan.";
        }
      } finally {
        if (scanId === draftScanId) scanning = false;
      }
    },
    async rescanCommitted() {
      await scanCommitted(copyExecutableOverride(committedSettings.executableOverride));
    },
    discard() {
      draftScanId += 1;
      scanning = false;
      draftSettings = copySettings(committedSettings);
      draftReport = committedReport;
      draftReportInput = copyExecutableOverride(committedReportInput);
      scanError = null;
      saveError = null;
    },
    async save(): Promise<boolean> {
      if (saving || loadStatus === "unsupported-version") return false;
      const executableOverride = draftSettings.executableOverride;
      if (
        draftSettings.runtimeOverride !== null &&
        executableOverride !== null &&
        draftSettings.runtimeOverride !== executableOverride.runtime
      ) {
        saveError = "Settings could not be saved.";
        return false;
      }
      saving = true;
      saveError = null;
      const nextSettings = copySettings(draftSettings);
      try {
        if (!(await repository.save(nextSettings))) {
          saveError = "Settings could not be saved.";
          return false;
        }
        committedSettings = copySettings(nextSettings);
        scanError = null;
        if (sameExecutableOverride(draftReportInput, nextSettings.executableOverride)) {
          committedReport = draftReport;
          committedReportInput = copyExecutableOverride(draftReportInput);
        } else if (!sameExecutableOverride(committedReportInput, nextSettings.executableOverride)) {
          // Saving is complete once persistence succeeds. Refresh discovery in the background so
          // a slow executable cannot hold the Application Settings Modal open.
          void scanCommitted(nextSettings.executableOverride);
        }
        return true;
      } finally {
        saving = false;
      }
    },
  };
}
