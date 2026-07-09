<script lang="ts">
  import type { DocumentTabDebugSummary } from "$lib/debug/spike-api";

  type Props = {
    tabs: DocumentTabDebugSummary[];
    onActivate: (id: string) => void | Promise<void>;
    onClose: (id: string) => void | Promise<void>;
    onOpen: () => void | Promise<void>;
  };

  let { tabs, onActivate, onClose, onOpen }: Props = $props();
</script>

<div class="document-tab-bar" role="tablist" aria-label="Open documents">
  <div class="document-tabs">
    {#each tabs as tab (tab.id)}
      <div class="document-tab-item" class:is-active={tab.active}>
        <button
          class="document-tab"
          type="button"
          role="tab"
          id={`doc-tab-${tab.id}`}
          aria-selected={tab.active}
          aria-label={tab.label}
          title={tab.path ?? tab.label}
          onclick={() => onActivate(tab.id)}
        >
          {#if tab.dirty}
            <span class="document-tab-dirty" aria-hidden="true"></span>
          {/if}
          <span class="document-tab-label">{tab.label}</span>
        </button>
        <button
          class="document-tab-close"
          type="button"
          aria-label={`Close ${tab.label}`}
          title={`Close ${tab.label}`}
          onclick={(event) => {
            event.stopPropagation();
            onClose(tab.id);
          }}
        >
          ×
        </button>
      </div>
    {/each}
  </div>
  <button class="document-tab-open" type="button" aria-label="Open PDF" title="Open PDF" onclick={onOpen}>
    +
  </button>
</div>

<style>
  .document-tab-bar {
    min-height: 38px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3) 0;
    background: color-mix(in oklab, var(--surface), var(--bg) 58%);
    border-bottom: 1px solid var(--border);
  }

  .document-tabs {
    display: flex;
    align-items: end;
    gap: var(--space-1);
    overflow-x: auto;
    scrollbar-width: none;
    min-width: 0;
  }

  .document-tabs::-webkit-scrollbar {
    display: none;
  }

  .document-tab-item {
    min-width: 120px;
    max-width: 220px;
    height: 32px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 28px;
    align-items: stretch;
    border: 1px solid var(--border);
    border-bottom-color: transparent;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    background: color-mix(in oklab, var(--surface), var(--bg) 35%);
    color: var(--muted);
    flex: 0 1 180px;
  }

  .document-tab-item.is-active {
    background: var(--bg);
    color: var(--fg);
    border-bottom-color: var(--bg);
  }

  .document-tab,
  .document-tab-close,
  .document-tab-open {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .document-tab {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    text-align: left;
    cursor: default;
  }

  .document-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .document-tab-dirty {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-pill);
    background: var(--warn);
    flex: none;
  }

  .document-tab-close {
    display: grid;
    place-items: center;
    font-size: 16px;
    opacity: 0.72;
    cursor: default;
  }

  .document-tab-close:hover,
  .document-tab-open:hover {
    background: color-mix(in oklab, var(--fg), transparent 92%);
  }

  .document-tab-open {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-bottom-color: transparent;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    background: var(--surface);
    color: var(--muted);
    font-size: 18px;
    line-height: 1;
    cursor: default;
  }

  .document-tab:focus-visible,
  .document-tab-close:focus-visible,
  .document-tab-open:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    position: relative;
    z-index: 2;
  }
</style>
