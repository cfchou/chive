<script lang="ts">
  // The Document Tab Bar: the strip of open PDFs shown in the window's titlebar
  // area (see CONTEXT.md "Document Tab Bar"). Distinct from the sidebar TabStrip.
  export type DocumentTabItem = {
    id: string;
    label: string;
    path: string | null;
    dirty: boolean;
    active: boolean;
  };

  type Props = {
    tabs: DocumentTabItem[];
    /** Reserve space for the macOS traffic lights (Tauri, not fullscreen). */
    trafficLightInset?: boolean;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onNew: () => void;
  };

  let { tabs, trafficLightInset = false, onSelect, onClose, onNew }: Props = $props();

  const basename = (label: string) => label.split(/[\\/]/).pop() || label;
</script>

<div
  class="doc-tab-bar"
  class:has-inset={trafficLightInset}
  role="tablist"
  aria-label="Open documents"
  data-tauri-drag-region
>
  <div class="doc-tabs">
    {#each tabs as tab (tab.id)}
      <div class="doc-tab" class:is-active={tab.active} data-doc-tab={tab.id}>
        <button
          class="doc-tab-main"
          type="button"
          role="tab"
          aria-selected={tab.active}
          title={tab.path ?? basename(tab.label)}
          onclick={() => onSelect(tab.id)}
        >
          {#if tab.dirty}
            <span class="dirty-dot" aria-hidden="true"></span>
          {/if}
          <span class="doc-tab-label">{basename(tab.label)}</span>
        </button>
        <button
          class="doc-tab-close"
          type="button"
          aria-label={`Close ${basename(tab.label)}`}
          onclick={() => onClose(tab.id)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    {/each}
  </div>
  <button class="doc-tab-new" type="button" aria-label="Open PDF in new tab" onclick={onNew}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  </button>
</div>

<style>
  .doc-tab-bar {
    display: flex;
    align-items: flex-end;
    gap: var(--space-1);
    height: 40px;
    padding: 0 var(--space-2);
    background: var(--surface-warm, var(--surface));
    border-bottom: 1px solid var(--border);
    overflow: hidden;
  }
  /* Clear the macOS traffic lights when the overlay titlebar is active. */
  .doc-tab-bar.has-inset {
    padding-left: 78px;
  }
  .doc-tabs {
    display: flex;
    align-items: flex-end;
    gap: var(--space-1);
    min-width: 0;
    flex: 1 1 auto;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .doc-tabs::-webkit-scrollbar {
    display: none;
  }
  .doc-tab {
    display: flex;
    align-items: center;
    min-width: 120px;
    max-width: 220px;
    height: 30px;
    padding: 0 var(--space-1) 0 var(--space-3);
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background: var(--surface);
    color: var(--muted);
  }
  .doc-tab.is-active {
    background: var(--bg);
    color: var(--fg);
  }
  .doc-tab-main {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    flex: 1 1 auto;
    border: none;
    background: none;
    color: inherit;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    cursor: default;
    padding: 0;
    text-align: left;
  }
  .doc-tab-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dirty-dot {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent, #d97706);
  }
  .doc-tab-close,
  .doc-tab-new {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: var(--radius-sm, 4px);
    background: none;
    color: var(--muted);
    cursor: default;
  }
  .doc-tab-close {
    margin-left: var(--space-1);
    opacity: 0;
  }
  .doc-tab:hover .doc-tab-close,
  .doc-tab.is-active .doc-tab-close {
    opacity: 1;
  }
  .doc-tab-close:hover,
  .doc-tab-new:hover {
    background: color-mix(in oklab, var(--fg), transparent 90%);
    color: var(--fg);
  }
  .doc-tab-new {
    align-self: center;
    width: 26px;
    height: 26px;
  }
  .doc-tab-close svg,
  .doc-tab-new svg {
    width: 13px;
    height: 13px;
    stroke: currentColor;
    stroke-width: 1.6;
    fill: none;
    pointer-events: none;
  }
  .doc-tab-main:focus-visible,
  .doc-tab-close:focus-visible,
  .doc-tab-new:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    position: relative;
    z-index: 2;
  }
</style>
