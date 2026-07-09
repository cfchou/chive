<script lang="ts">
  import type { DocumentTabDebugSummary } from "$lib/debug/spike-api";

  type Props = {
    tabs: DocumentTabDebugSummary[];
    onActivate: (id: string) => void | Promise<void>;
    onClose: (id: string) => void | Promise<void>;
    onOpen: () => void | Promise<void>;
    onReorder: (fromIndex: number, toIndex: number) => void;
  };

  const DRAG_START_PX = 6;

  let { tabs, onActivate, onClose, onOpen, onReorder }: Props = $props();
  let dragState = $state<{
    id: string;
    fromIndex: number;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  let suppressClickForId: string | null = null;

  function handleTabPointerDown(tab: DocumentTabDebugSummary, index: number, event: PointerEvent) {
    if (event.button !== 0) return;
    if ((event.target as Element | null)?.closest(".document-tab-close")) return;
    dragState = {
      id: tab.id,
      fromIndex: index,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
    };
  }

  function handleWindowPointerMove(event: PointerEvent) {
    if (!dragState) return;
    if (!dragState.started) {
      const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
      if (distance < DRAG_START_PX) return;
      dragState.started = true;
    }
    event.preventDefault();
  }

  function handleWindowPointerUp(event: PointerEvent) {
    const drag = dragState;
    dragState = null;
    if (!drag?.started) return;

    event.preventDefault();
    suppressClickForId = drag.id;
    setTimeout(() => {
      if (suppressClickForId === drag.id) suppressClickForId = null;
    });

    const toIndex = dropIndexForClientX(drag.id, event.clientX);
    if (toIndex !== drag.fromIndex) {
      onReorder(drag.fromIndex, toIndex);
    }
  }

  function handleWindowPointerCancel() {
    dragState = null;
  }

  function dropIndexForClientX(draggedId: string, clientX: number) {
    const items = Array.from(
      document.querySelectorAll<HTMLElement>(".document-tab-item[data-document-tab-id]"),
    ).filter((item) => item.dataset.documentTabId !== draggedId);
    let index = 0;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (clientX > rect.left + rect.width / 2) index += 1;
    }
    return Math.min(Math.max(index, 0), tabs.length - 1);
  }

  function handleTabClick(id: string) {
    if (suppressClickForId === id) {
      suppressClickForId = null;
      return;
    }
    void onActivate(id);
  }
</script>

<svelte:window
  onpointermove={handleWindowPointerMove}
  onpointerup={handleWindowPointerUp}
  onpointercancel={handleWindowPointerCancel}
/>

<div class="document-tab-bar" role="tablist" aria-label="Open documents">
  <div class="document-tabs">
    {#each tabs as tab, index (tab.id)}
      <div
        class="document-tab-item"
        class:is-active={tab.active}
        class:is-dragging={dragState?.id === tab.id && dragState.started}
        data-document-tab-id={tab.id}
      >
        <button
          class="document-tab"
          type="button"
          role="tab"
          id={`doc-tab-${tab.id}`}
          aria-selected={tab.active}
          aria-label={tab.label}
          title={tab.path ?? tab.label}
          onpointerdown={(event) => handleTabPointerDown(tab, index, event)}
          onclick={() => handleTabClick(tab.id)}
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

  .document-tab-item.is-dragging {
    opacity: 0.72;
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
