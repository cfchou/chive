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
  }>();

  let draggingTab: DockTab | null = null;
  let startX = 0;
  let moved = false;
  let suppressNextClick = false;

  function handlePointerDown(event: PointerEvent, tab: DockTab) {
    draggingTab = tab;
    startX = event.clientX;
    moved = false;
    event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!draggingTab) return;
    if (Math.abs(event.clientX - startX) > 4) moved = true;
  }

  function handlePointerUp(event: PointerEvent) {
    const tab = draggingTab;
    draggingTab = null;
    if (!tab) return;

    let targetSide: DockSide | null = null;
    if (event.clientX <= EDGE_DOCK_PX) targetSide = "left";
    if (event.clientX >= window.innerWidth - EDGE_DOCK_PX) targetSide = "right";

    if (targetSide && targetSide !== side) {
      dispatch("dock", { tab, side: targetSide });
      suppressNextClick = true;
      return;
    }

    if (!moved) {
      dispatch("activate", { tab });
      suppressNextClick = true;
      return;
    }
    suppressNextClick = true;
  }

  function handleClick(tab: DockTab) {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    dispatch("activate", { tab });
  }
</script>

<div class="sidebar-tabs" role="tablist" aria-label="{side} sidebar tabs" data-testid="{side}-tabstrip">
  {#each tabs as tab}
    <button
      type="button"
      class:is-dragging={draggingTab === tab}
      class="sidebar-tab"
      role="tab"
      aria-label={TAB_LABELS[tab]}
      aria-selected={active === tab}
      data-testid="{side}-tab-{tab}"
      on:pointerdown={(event) => handlePointerDown(event, tab)}
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
      on:click={() => handleClick(tab)}
    >
      <Icon name={tab} />
    </button>
  {/each}
</div>

<style>
  .sidebar-tabs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(42px, 42px));
    gap: var(--space-1);
    min-height: 48px;
    padding: var(--space-3) 48px 0 var(--space-3);
    background: var(--bg);
  }

  :global(.sidebar[data-side="right"]) .sidebar-tabs {
    padding: var(--space-3) var(--space-3) 0 48px;
  }

  .sidebar-tab {
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
    opacity: 0.45;
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
