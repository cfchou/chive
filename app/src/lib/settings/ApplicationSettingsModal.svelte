<script lang="ts">
  import type { SettingsSection } from "./settings-section";

  type Props = {
    sections: readonly SettingsSection[];
    dirty: boolean;
    onSave: () => void;
    onCancel: () => void;
  };

  let { sections, dirty, onSave, onCancel }: Props = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  let closeButton = $state<HTMLButtonElement | null>(null);
  let previouslyFocused: HTMLElement | null = null;

  export function focusInitialControl(): void {
    const firstSectionControl = dialog?.querySelector<HTMLElement>(
      '[data-settings-content] button:not([disabled]), [data-settings-content] input:not([disabled]), [data-settings-content] select:not([disabled]), [data-settings-content] textarea:not([disabled]), [data-settings-content] [tabindex]:not([tabindex="-1"])',
    );
    (firstSectionControl ?? closeButton)?.focus();
  }

  $effect(() => {
    const modal = dialog;
    if (!modal) return;
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!modal.open) modal.showModal();
    queueMicrotask(focusInitialControl);
    return () => {
      if (modal.open) modal.close();
      if (
        previouslyFocused?.isConnected &&
        !previouslyFocused.matches(":disabled")
      ) {
        previouslyFocused.focus();
      }
    };
  });

  function handleDialogCancel(event: Event) {
    event.preventDefault();
    onCancel();
  }
</script>

<dialog
  class="application-settings-modal"
  bind:this={dialog}
  aria-modal="true"
  aria-labelledby="application-settings-title"
  oncancel={handleDialogCancel}
>
  <header class="settings-header">
    <h2 id="application-settings-title">Settings</h2>
    <button
      class="icon-button"
      type="button"
      aria-label="Close Settings"
      bind:this={closeButton}
      onclick={onCancel}
    >
      ×
    </button>
  </header>

  <div class="settings-body" data-settings-content>
    {#if sections.length === 0}
      <p class="settings-empty">No settings available</p>
    {:else}
      {#each sections as section (section.id)}
        <section aria-labelledby={`settings-section-${section.id}`}>
          <h3 id={`settings-section-${section.id}`}>{section.label}</h3>
          {@render section.content()}
        </section>
      {/each}
    {/if}
  </div>

  <footer class="settings-actions">
    <button type="button" onclick={onCancel}>Cancel</button>
    <button class="primary" type="button" disabled={!dirty || sections.length === 0} onclick={onSave}>
      Save
    </button>
  </footer>
</dialog>

<style>
  .application-settings-modal {
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    width: min(620px, calc(100vw - 2 * var(--space-5)));
    max-width: calc(100vw - 2 * var(--space-5));
    min-height: 330px;
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 12px);
    background: var(--bg);
    color: var(--fg);
    box-shadow: var(--elev-raised);
  }

  .application-settings-modal::backdrop {
    background: color-mix(in oklab, #000, transparent 55%);
  }

  .settings-header,
  .settings-actions {
    display: flex;
    align-items: center;
    padding: var(--space-4) var(--space-5);
  }

  .settings-header {
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    font-family: var(--font-display);
    font-size: var(--text-lg, 1.1rem);
  }

  h3 {
    margin-bottom: var(--space-3);
    font-family: var(--font-display);
    font-size: var(--text-md, 1rem);
  }

  .icon-button,
  .settings-actions button {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--fg);
    font-family: var(--font-display);
    cursor: default;
  }

  .icon-button {
    width: 30px;
    height: 30px;
    padding: 0;
    font-size: 1.25rem;
    line-height: 1;
  }

  .settings-body {
    min-height: 190px;
    padding: var(--space-5);
  }

  .settings-empty {
    color: var(--muted);
  }

  .settings-actions {
    justify-content: flex-end;
    gap: var(--space-2);
    border-top: 1px solid var(--border);
  }

  .settings-actions button {
    padding: var(--space-2) var(--space-4);
  }

  .settings-actions .primary {
    border-color: transparent;
    background: var(--accent);
    color: var(--accent-on);
  }

  .settings-actions .primary:disabled {
    opacity: 0.45;
  }

  button:focus-visible,
  :global([data-settings-content] input:focus-visible),
  :global([data-settings-content] select:focus-visible),
  :global([data-settings-content] textarea:focus-visible) {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
