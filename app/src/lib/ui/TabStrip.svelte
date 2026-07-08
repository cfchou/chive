<script lang="ts">
  import type { SidebarSide, SidebarTabId } from "./dock-state";

  type Props = {
    side: SidebarSide;
    tabs: SidebarTabId[];
    activeTab: SidebarTabId | null;
    draggingTab: SidebarTabId | null;
    isDropTarget: boolean;
    onTabClick: (tab: SidebarTabId) => void;
    onTabPointerDown: (tab: SidebarTabId, event: PointerEvent) => void;
  };

  let { side, tabs, activeTab, draggingTab, isDropTarget, onTabClick, onTabPointerDown }: Props =
    $props();

  const tabMeta: Record<SidebarTabId, { label: string; icon: string }> = {
    outline: { label: "Outline", icon: "M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10" },
    bookmarks: { label: "Bookmarks", icon: "M7 4h10v16l-5-3-5 3z" },
    annotations: { label: "Annotations", icon: "M4 20h5l10-10a3 3 0 0 0-5-5L4 15zM13 6l5 5" },
  };
</script>

<div
  class="sidebar-tabs"
  class:is-drop-target={isDropTarget}
  role="tablist"
  aria-label={side === "left" ? "Left document sidebar" : "Right document sidebar"}
  data-tab-strip={side}
>
  {#each tabs as tab (tab)}
    <button
      class="sidebar-tab"
      class:is-dragging={draggingTab === tab}
      id={`tab-${tab}`}
      type="button"
      role="tab"
      aria-selected={activeTab === tab}
      aria-controls={`panel-${tab}`}
      aria-label={tabMeta[tab].label}
      title={tabMeta[tab].label}
      data-tab={tab}
      onclick={() => onTabClick(tab)}
      onpointerdown={(event) => onTabPointerDown(tab, event)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={tabMeta[tab].icon}></path>
      </svg>
    </button>
  {/each}
</div>

<style>
  .sidebar-tabs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(42px, 42px));
    gap: var(--space-1);
    padding: var(--space-3) 48px 0 var(--space-3);
    background: var(--bg);
    min-height: 48px;
  }
  .sidebar-tabs[data-tab-strip="right"] {
    padding: var(--space-3) var(--space-3) 0 48px;
  }
  .sidebar-tabs.is-drop-target {
    background: color-mix(in oklab, var(--fg), transparent 96%);
  }
  .sidebar-tab {
    width: 42px;
    min-height: 36px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background: var(--surface);
    color: var(--muted);
    font-family: var(--font-display);
    font-size: var(--text-sm);
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
    display: grid;
    place-items: center;
  }
  .sidebar-tab svg {
    width: 17px;
    height: 17px;
    stroke: currentColor;
    stroke-width: 1.8;
    fill: none;
    pointer-events: none;
  }
  .sidebar-tab.is-dragging {
    opacity: 0.45;
    cursor: grabbing;
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
