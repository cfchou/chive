<script lang="ts">
  import type { DocumentTabId } from "$lib/tabs/tab-state";

  type TabSummary = {
    id: DocumentTabId;
    label: string;
    path: string | null;
    dirty: boolean;
    active: boolean;
  };

  let {
    tabs = [],
    onactivate,
    onclose,
    onopen,
    isTauri = false,
    isFullscreen = false,
  }: {
    tabs: TabSummary[];
    onactivate: (id: string) => void;
    onclose: (id: string) => void;
    onopen: () => void;
    isTauri: boolean;
    isFullscreen: boolean;
  } = $props();
</script>

{#if !isFullscreen}
  <div class="document-tab-bar" data-tauri-drag-region={isTauri ? "" : undefined}>
    <div class="traffic-light-spacer" data-tauri-drag-region={isTauri ? "" : undefined}></div>
    <div class="tab-scroll" role="tablist" aria-label="Open documents">
      {#each tabs as tab (tab.id)}
        <button
          id={`doc-tab-${tab.id}`}
          role="tab"
          aria-selected={tab.active}
          class="doc-tab"
          class:active={tab.active}
          title={tab.path ?? tab.label}
          onclick={() => onactivate(tab.id)}
        >
          <span class="doc-tab-label">{tab.label}</span>
          {#if tab.dirty}
            <span class="doc-tab-dirty-dot" aria-hidden="true"></span>
          {/if}
          <span
            class="doc-tab-close"
            role="button"
            tabindex="-1"
            aria-label="Close tab"
            onclick={(e) => { e.stopPropagation(); onclose(tab.id); }}
            onkeydown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onclose(tab.id); } }}
          >×</span>
        </button>
      {/each}
    </div>
    <button
      class="doc-tab-add"
      type="button"
      aria-label="Open a new document"
      onclick={onopen}
    >+</button>
  </div>
{/if}

<style>
  .document-tab-bar {
    display: flex;
    align-items: center;
    height: 40px;
    min-height: 40px;
    background: var(--bg, #f0f0f0);
    border-bottom: 1px solid var(--border, #ccc);
    gap: 0;
    padding: 0 4px 0 0;
    user-select: none;
  }

  .traffic-light-spacer {
    width: 80px;
    min-width: 80px;
    height: 100%;
  }

  .tab-scroll {
    display: flex;
    align-items: center;
    gap: 1px;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1;
    scrollbar-width: none;
  }
  .tab-scroll::-webkit-scrollbar {
    display: none;
  }

  .doc-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px 4px 12px;
    min-width: 120px;
    max-width: 220px;
    height: 28px;
    border: none;
    border-radius: 6px 6px 0 0;
    background: transparent;
    color: var(--text, #333);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 80ms;
  }
  .doc-tab:hover {
    background: var(--surface, #e8e8e8);
  }
  .doc-tab.active {
    background: var(--surface, #fff);
    box-shadow: 0 -1px 0 0 var(--border, #ccc) inset;
  }

  .doc-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .doc-tab-dirty-dot {
    width: 6px;
    height: 6px;
    min-width: 6px;
    border-radius: 50%;
    background: var(--text, #333);
    opacity: 0.6;
  }

  .doc-tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    min-width: 16px;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1;
    opacity: 0;
    cursor: pointer;
  }
  .doc-tab:hover .doc-tab-close,
  .doc-tab.active .doc-tab-close {
    opacity: 0.5;
  }
  .doc-tab-close:hover {
    opacity: 1;
    background: var(--border, #ddd);
  }

  .doc-tab-add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    min-width: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text, #333);
    font-size: 16px;
    cursor: pointer;
    opacity: 0.5;
  }
  .doc-tab-add:hover {
    opacity: 1;
    background: var(--surface, #e8e8e8);
  }

  /* Browser build: no traffic-light spacer */
  :global(.browser-build) .traffic-light-spacer {
    display: none;
  }
</style>
