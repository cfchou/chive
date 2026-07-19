<!--
  This section renders the current settings draft and sends user actions back to the session.
  It does not load, save, or scan on its own. Its local runtime choice belongs only to the
  Executable Override editor; the choice becomes part of the draft when a path is entered.
-->
<script lang="ts">
  import type { ApplicationSettings, RuntimeId } from "./application-settings";
  import type {
    RuntimeDiscoveryReport,
    RuntimeProbe,
    RuntimeSelection,
  } from "./runtime-discovery";
  import type { RuntimeSettingsDraftAction } from "./runtime-settings-session.svelte";

  type Props = {
    draft: ApplicationSettings;
    report: RuntimeDiscoveryReport;
    selection: RuntimeSelection;
    scanning: boolean;
    scanError: string | null;
    saveError: string | null;
    loadError: string | null;
    onDraftAction: (action: RuntimeSettingsDraftAction) => void;
    onRescan: () => void | Promise<void>;
  };

  let {
    draft,
    report,
    selection,
    scanning,
    scanError,
    saveError,
    loadError,
    onDraftAction,
    onRescan,
  }: Props = $props();

  const runtimeNames: Record<RuntimeId, string> = {
    codex: "Codex",
    opencode: "OpenCode",
    "claude-code": "Claude Code",
  };
  let editorRuntime = $state<RuntimeId>("codex");
  let editorRuntimeChosen = $state(false);

  $effect(() => {
    const requiredRuntime = draft.executableOverride?.runtime ?? draft.runtimeOverride;
    if (requiredRuntime !== undefined && requiredRuntime !== null) {
      editorRuntime = requiredRuntime;
      editorRuntimeChosen = false;
    } else if (!editorRuntimeChosen) {
      // Follow Chive's derived selection until the user chooses a runtime in this editor.
      editorRuntime = selection.runtime ?? "codex";
    }
  });

  function unavailableMessage(probe: Extract<RuntimeProbe, { status: "unavailable" }>): string {
    switch (probe.reason) {
      case "not-found":
        return "Not found. Set an Executable Override and Rescan.";
      case "override-not-absolute":
        return "The override must be an absolute path. Clear it or correct it, then Rescan.";
      case "path-not-found":
        return "The override path was not found. Clear it or correct it, then Rescan.";
      case "path-not-file":
        return "The override path is not a file. Clear it or correct it, then Rescan.";
      case "path-not-executable":
        return "The override path is not executable. Clear it or correct it, then Rescan.";
      case "probe-timeout":
        return "The version check timed out. Try Rescan.";
      case "scan-budget-exhausted":
        return "Discovery took too long. Set an Executable Override and Rescan.";
      case "probe-failed":
        return "The version check failed. Try Rescan.";
      case "version-unreadable":
        return "The runtime did not report a readable version. Try Rescan.";
    }
  }

  function updateExecutablePath(path: string) {
    onDraftAction({ type: "set-executable-override", runtime: editorRuntime, path });
  }
</script>

<div class="runtime-settings">
  <p class="selection-summary">
    {#if selection.runtime === null}
      No supported runtime is ready.
    {:else if selection.source === "runtime-override" && !selection.ready}
      Selected runtime: {runtimeNames[selection.runtime]} — unavailable. {unavailableMessage(
        selection.probe as Extract<RuntimeProbe, { status: "unavailable" }>,
      )}
    {:else}
      Selected runtime: {runtimeNames[selection.runtime]}.
      {selection.source === "runtime-override"
        ? "User override."
        : "Chosen by Chive's built-in priority."}
    {/if}
  </p>

  <div class="runtime-list">
    {#each report.runtimes as probe (probe.runtime)}
      <article class:selected={selection.runtime === probe.runtime} class="runtime-row">
        <div>
          <strong>{runtimeNames[probe.runtime]}</strong>
          <span>{probe.status === "ready" ? "Ready" : unavailableMessage(probe)}</span>
          {#if probe.status === "ready"}
            <span>{probe.version}</span>
          {/if}
          {#if probe.displayPath}
            <code>{probe.displayPath}</code>
          {/if}
        </div>
        <div class="runtime-row-actions">
          {#if selection.runtime === probe.runtime && selection.source === "built-in-priority"}
            <button
              type="button"
              onclick={() =>
                onDraftAction({ type: "set-runtime-override", runtime: probe.runtime })}
            >Always use {runtimeNames[probe.runtime]}</button>
          {:else if draft.runtimeOverride !== probe.runtime}
            <button
              type="button"
              onclick={() =>
                onDraftAction({ type: "set-runtime-override", runtime: probe.runtime })}
            >Use {runtimeNames[probe.runtime]}</button>
          {/if}
          {#if selection.runtime === probe.runtime}
            <span class="selected-label">Selected</span>
          {/if}
        </div>
      </article>
    {/each}
  </div>

  {#if draft.runtimeOverride !== null}
    <button
      type="button"
      onclick={() => onDraftAction({ type: "set-runtime-override", runtime: null })}
    >Use Chive default</button>
  {/if}

  <fieldset>
    <legend>Executable override</legend>
    <label>
      Runtime
      <select
        value={editorRuntime}
        disabled={draft.runtimeOverride !== null}
        onchange={(event) => {
          const nextRuntime = event.currentTarget.value as RuntimeId;
          if (draft.executableOverride && draft.executableOverride.runtime !== nextRuntime) {
            // A path belongs to one runtime. Do not show the old path under another runtime.
            onDraftAction({ type: "clear-executable-override" });
          }
          editorRuntime = nextRuntime;
          editorRuntimeChosen = true;
        }}
      >
        {#each Object.entries(runtimeNames) as [runtime, name]}
          <option value={runtime}>{name}</option>
        {/each}
      </select>
    </label>
    <label>
      Executable path
      <input
        type="text"
        value={draft.executableOverride?.path ?? ""}
        oninput={(event) => updateExecutablePath(event.currentTarget.value)}
      />
    </label>
    {#if draft.executableOverride !== null}
      <button
        type="button"
        onclick={() => onDraftAction({ type: "clear-executable-override" })}
      >Clear executable override</button>
    {/if}
  </fieldset>

  <div class="scan-actions">
    <button type="button" disabled={scanning} onclick={() => void onRescan()}>
      {scanning ? "Scanning…" : "Rescan"}
    </button>
    <span aria-live="polite">{scanning ? "Scanning…" : ""}</span>
  </div>
  {#if loadError}<p class="settings-error" role="alert">{loadError}</p>{/if}
  {#if scanError}<p class="settings-error" role="alert">{scanError}</p>{/if}
  {#if saveError}<p class="settings-error" role="alert">{saveError}</p>{/if}
</div>

<style>
  .runtime-settings,
  .runtime-list,
  .runtime-row > div,
  fieldset,
  label {
    display: grid;
    gap: var(--space-2);
  }

  .runtime-settings {
    gap: var(--space-4);
  }

  .selection-summary,
  .runtime-row span,
  .settings-error {
    margin: 0;
    color: var(--muted);
  }

  .runtime-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .runtime-row.selected {
    border-color: var(--accent);
  }

  .runtime-row-actions,
  .scan-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  fieldset {
    margin: 0;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  input,
  select {
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-2);
  }

  button,
  input,
  select {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--fg);
  }

  button {
    padding: var(--space-2) var(--space-3);
  }

  code {
    overflow-wrap: anywhere;
  }

  .settings-error {
    color: var(--danger, #a33);
  }
</style>
