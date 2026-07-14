// Pure model for the dockable sidebar tabs.
// Tabs live in one of two strips (left/right); each side tracks its own active
// tab and hidden flag. All transitions return a new state object so the page
// can hold the whole thing in one `$state` and reassign.

export type SidebarTabId = "outline" | "bookmarks" | "annotations" | "ai-chat";
export type SidebarSide = "left" | "right";

export type DockState = {
  order: Record<SidebarSide, SidebarTabId[]>;
  active: Record<SidebarSide, SidebarTabId | null>;
  hidden: Record<SidebarSide, boolean>;
};

export const sidebarTabIds: SidebarTabId[] = ["outline", "bookmarks", "annotations", "ai-chat"];

export function createDefaultDockState(): DockState {
  return {
    order: { left: ["outline", "bookmarks", "annotations"], right: ["ai-chat"] },
    active: { left: "outline", right: "ai-chat" },
    hidden: { left: false, right: false },
  };
}

function cloneDockState(state: DockState): DockState {
  return {
    order: { left: [...state.order.left], right: [...state.order.right] },
    active: { ...state.active },
    hidden: { ...state.hidden },
  };
}

export function sideOfTab(state: DockState, tab: SidebarTabId): SidebarSide | null {
  if (state.order.left.includes(tab)) return "left";
  if (state.order.right.includes(tab)) return "right";
  return null;
}

export function sideHasTabs(state: DockState, side: SidebarSide): boolean {
  return state.order[side].length > 0;
}

export function isSideOpen(state: DockState, side: SidebarSide): boolean {
  return sideHasTabs(state, side) && !state.hidden[side];
}

export function shouldShowEdgeReopen(state: DockState, side: SidebarSide): boolean {
  return sideHasTabs(state, side) && state.hidden[side];
}

function ensureActiveTabInPlace(state: DockState, side: SidebarSide): void {
  const active = state.active[side];
  if (active && state.order[side].includes(active)) return;
  state.active[side] = state.order[side][0] ?? null;
}

export function activateTab(state: DockState, tab: SidebarTabId): DockState {
  const side = sideOfTab(state, tab);
  if (!side) return state;
  const next = cloneDockState(state);
  next.active[side] = tab;
  next.hidden[side] = false;
  return next;
}

export function moveTabToSide(
  state: DockState,
  tab: SidebarTabId,
  targetSide: SidebarSide,
  beforeTab: SidebarTabId | null = null,
): DockState {
  const sourceSide = sideOfTab(state, tab);
  if (!sourceSide) return state;
  const wasActive = state.active[sourceSide] === tab;

  const next = cloneDockState(state);
  next.order[sourceSide] = next.order[sourceSide].filter((id) => id !== tab);
  const target = next.order[targetSide];
  const beforeIndex = beforeTab ? target.indexOf(beforeTab) : -1;
  if (beforeIndex >= 0) target.splice(beforeIndex, 0, tab);
  else target.push(tab);

  next.hidden[targetSide] = false;
  if (wasActive) next.active[targetSide] = tab;
  ensureActiveTabInPlace(next, sourceSide);
  ensureActiveTabInPlace(next, targetSide);
  return next;
}

export function hideSide(state: DockState, side: SidebarSide): DockState {
  if (!sideHasTabs(state, side)) return state;
  const next = cloneDockState(state);
  next.hidden[side] = true;
  return next;
}

export function showSide(state: DockState, side: SidebarSide): DockState {
  const next = cloneDockState(state);
  next.hidden[side] = false;
  return next;
}
