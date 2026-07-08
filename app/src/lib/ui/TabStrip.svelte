<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { EDGE_DOCK_PX, TAB_LABELS, type DockSide, type DockTab } from "$lib/ui/dock-state";
  import Icon from "$lib/ui/Icon.svelte";

  export let side: DockSide;
  export let tabs: DockTab[] = [];
  export let active: DockTab | null = null;

  const dispatch = createEventDispatcher<{
    activate: { tab: DockTab };
    dock: { tab: DockTab; side: DockSide };
    reorder: { tab: DockTab; side: DockSide; targetIndex: number };
  }>();

  let draggingTab: DockTab | null = null;
  let startX = 0;
  let moved = false;
  let suppressNextClick = false;
  let dropSide: DockSide | null = null;
  let reorderPreviewIndex: number | null = null;
  let pointerX = 0;
  let pointerY = 0;

  $: showReorderPreview = Boolean(draggingTab && moved && dropSide === side && reorderPreviewIndex !== null);
  $: showDragPreview = Boolean(draggingTab && moved);
  $: dragPreviewStyle = `transform: translate(${pointerX + 12}px, ${pointerY + 12}px);`;

  function handlePointerDown(event: PointerEvent, tab: DockTab) {
    draggingTab = tab;
    startX = event.clientX;
    pointerX = event.clientX;
    pointerY = event.clientY;
    moved = false;
    dropSide = side;
    reorderPreviewIndex = null;
    event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!draggingTab) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (Math.abs(event.clientX - startX) > 4) moved = true;
    if (!moved) return;

    dropSide = sideFromDropTarget(event);
    if (event.clientX <= EDGE_DOCK_PX) dropSide = "left";
    if (event.clientX >= window.innerWidth - EDGE_DOCK_PX) dropSide = "right";
    reorderPreviewIndex = dropSide === side ? reorderIndexForPointer(draggingTab, event) : null;
  }

  function sideFromDropTarget(event: PointerEvent): DockSide | null {
    for (const candidateSide of ["left", "right"] as const) {
      const strip = document.querySelector<HTMLElement>(`[data-testid='${candidateSide}-tabstrip']`);
      const rect = strip?.getBoundingClientRect();
      if (
        rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        return candidateSide;
      }
    }

    const dropTarget = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-testid='left-tabstrip'], [data-testid='right-tabstrip']");
    const testId = dropTarget?.dataset.testid;
    if (testId === "left-tabstrip") return "left";
    if (testId === "right-tabstrip") return "right";
    return null;
  }

  function reorderIndexForPointer(tab: DockTab, event: PointerEvent): number {
    const remainingTabs = tabs.filter((candidate) => candidate !== tab);

    for (let index = 0; index < remainingTabs.length; index += 1) {
      const tabElement = document.querySelector<HTMLElement>(`[data-testid='${side}-tab-${remainingTabs[index]}']`);
      const rect = tabElement?.getBoundingClientRect();
      if (rect && event.clientX < rect.left + rect.width / 2) {
        return index;
      }
    }

    return remainingTabs.length;
  }

  function handlePointerUp(event: PointerEvent) {
    const tab = draggingTab;
    if (!tab) return;

    let targetSide: DockSide | null = dropSide ?? sideFromDropTarget(event);
    if (event.clientX <= EDGE_DOCK_PX) targetSide = "left";
    if (event.clientX >= window.innerWidth - EDGE_DOCK_PX) targetSide = "right";

    if (targetSide && targetSide !== side) {
      clearDragState();
      dispatch("dock", { tab, side: targetSide });
      suppressNextClick = true;
      return;
    }

    if (targetSide === side && moved) {
      const targetIndex = reorderPreviewIndex ?? reorderIndexForPointer(tab, event);
      clearDragState();
      dispatch("reorder", { tab, side, targetIndex });
      suppressNextClick = true;
      return;
    }

    if (!moved) {
      clearDragState();
      dispatch("activate", { tab });
      suppressNextClick = true;
      return;
    }
    clearDragState();
    suppressNextClick = true;
  }

  function clearDragState() {
    draggingTab = null;
    moved = false;
    dropSide = null;
    reorderPreviewIndex = null;
  }

  function handleClick(tab: DockTab) {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    dispatch("activate", { tab });
  }
</script>

<div
  class:is-drag-active={draggingTab && moved}
  class="sidebar-tabs"
  role="tablist"
  aria-label="{side} sidebar tabs"
  data-testid="{side}-tabstrip"
>
  {#each tabs as tab, index}
    {#if showReorderPreview && reorderPreviewIndex === index}
      <span class="tab-drop-indicator" data-testid="{side}-tab-drop-indicator" aria-hidden="true"></span>
    {/if}
    <button
      type="button"
      class:is-dragging={draggingTab === tab && moved}
      class="sidebar-tab"
      role="tab"
      aria-label={TAB_LABELS[tab]}
      aria-selected={active === tab}
      data-dragging={draggingTab === tab && moved ? "true" : undefined}
      data-testid="{side}-tab-{tab}"
      on:pointerdown={(event) => handlePointerDown(event, tab)}
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
      on:pointercancel={clearDragState}
      on:click={() => handleClick(tab)}
    >
      <Icon name={tab} />
    </button>
  {/each}
  {#if showReorderPreview && reorderPreviewIndex === tabs.length}
    <span class="tab-drop-indicator" data-testid="{side}-tab-drop-indicator" aria-hidden="true"></span>
  {/if}
  {#if showDragPreview && draggingTab}
    <span
      class="tab-drag-preview"
      style={dragPreviewStyle}
      data-testid="{side}-tab-drag-preview"
      aria-hidden="true"
    >
      <Icon name={draggingTab} />
    </span>
  {/if}
</div>

<style>
  .sidebar-tabs {
    display: flex;
    align-items: end;
    gap: var(--space-1);
    min-height: 48px;
    padding: var(--space-3) 48px 0 var(--space-3);
    background: var(--bg);
  }

  .sidebar-tabs.is-drag-active {
    background: color-mix(in srgb, var(--accent) 8%, var(--bg));
  }

  :global(.sidebar[data-side="right"]) .sidebar-tabs {
    padding: var(--space-3) var(--space-3) 0 48px;
  }

  .sidebar-tab {
    flex: 0 0 42px;
    width: 42px;
    min-height: 36px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background: var(--surface);
    color: var(--muted);
    font-family: var(--font-display);
    font-size: var(--text-sm);
    user-select: none;
    touch-action: none;
  }

  .sidebar-tab.is-dragging {
    opacity: 0.72;
    transform: translateY(-2px);
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 24%, transparent);
    cursor: grabbing;
  }

  .tab-drop-indicator {
    flex: 0 0 4px;
    height: 36px;
    border-radius: 999px;
    background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .tab-drag-preview {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 40;
    width: 42px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 1px solid var(--accent);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background: var(--bg);
    color: var(--fg);
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--accent) 24%, transparent),
      var(--shadow-sm);
    pointer-events: none;
  }

  .sidebar-tab[aria-selected="true"] {
    background: var(--bg);
    color: var(--fg);
    border-bottom-color: var(--bg);
  }

  .sidebar-tab:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    position: relative;
    z-index: 2;
  }
</style>
