export type DockSide = "left" | "right";
export type DockTab = "outline" | "bookmarks" | "annotations";

export type DockState = {
  tabsBySide: Record<DockSide, DockTab[]>;
  activeBySide: Record<DockSide, DockTab | null>;
  hiddenSides: DockSide[];
};

export const EDGE_DOCK_PX = 38;

export const DOCK_TABS: DockTab[] = ["outline", "bookmarks", "annotations"];

export const TAB_LABELS: Record<DockTab, string> = {
  outline: "Outline",
  bookmarks: "Bookmarks",
  annotations: "Annotations",
};

export function createDockState(): DockState {
  return {
    tabsBySide: {
      left: [...DOCK_TABS],
      right: [],
    },
    activeBySide: {
      left: "outline",
      right: null,
    },
    hiddenSides: [],
  };
}

export function sideForTab(state: DockState, tab: DockTab): DockSide | null {
  if (state.tabsBySide.left.includes(tab)) return "left";
  if (state.tabsBySide.right.includes(tab)) return "right";
  return null;
}

export function activateTab(state: DockState, tab: DockTab): DockState {
  const side = sideForTab(state, tab);
  if (!side) return state;

  return ensureActiveTab({
    ...state,
    activeBySide: {
      ...state.activeBySide,
      [side]: tab,
    },
    hiddenSides: state.hiddenSides.filter((hiddenSide) => hiddenSide !== side),
  });
}

export function moveTabToSide(state: DockState, tab: DockTab, targetSide: DockSide): DockState {
  const nextTabsBySide: DockState["tabsBySide"] = {
    left: state.tabsBySide.left.filter((candidate) => candidate !== tab),
    right: state.tabsBySide.right.filter((candidate) => candidate !== tab),
  };

  nextTabsBySide[targetSide] = [...nextTabsBySide[targetSide], tab];

  return ensureActiveTab({
    ...state,
    tabsBySide: nextTabsBySide,
    activeBySide: {
      ...state.activeBySide,
      [targetSide]: tab,
    },
    hiddenSides: state.hiddenSides.filter((side) => side !== targetSide),
  });
}

export function reorderTabWithinSide(state: DockState, tab: DockTab, side: DockSide, targetIndex: number): DockState {
  if (!state.tabsBySide[side].includes(tab)) return state;

  const remainingTabs = state.tabsBySide[side].filter((candidate) => candidate !== tab);
  const clampedIndex = Math.min(Math.max(targetIndex, 0), remainingTabs.length);
  const reorderedTabs = [
    ...remainingTabs.slice(0, clampedIndex),
    tab,
    ...remainingTabs.slice(clampedIndex),
  ];

  return ensureActiveTab({
    ...state,
    tabsBySide: {
      ...state.tabsBySide,
      [side]: reorderedTabs,
    },
    activeBySide: {
      ...state.activeBySide,
      [side]: tab,
    },
    hiddenSides: state.hiddenSides.filter((hiddenSide) => hiddenSide !== side),
  });
}

export function hideSide(state: DockState, side: DockSide): DockState {
  if (state.hiddenSides.includes(side)) return state;
  return {
    ...state,
    hiddenSides: [...state.hiddenSides, side],
  };
}

export function showSide(state: DockState, side: DockSide): DockState {
  return ensureActiveTab({
    ...state,
    hiddenSides: state.hiddenSides.filter((hiddenSide) => hiddenSide !== side),
  });
}

export function ensureActiveTab(state: DockState): DockState {
  const activeBySide: DockState["activeBySide"] = {
    left: state.activeBySide.left,
    right: state.activeBySide.right,
  };

  for (const side of ["left", "right"] as const) {
    const tabs = state.tabsBySide[side];
    if (tabs.length === 0) {
      activeBySide[side] = null;
      continue;
    }

    if (!activeBySide[side] || !tabs.includes(activeBySide[side])) {
      activeBySide[side] = tabs[0];
    }
  }

  return {
    ...state,
    activeBySide,
  };
}

export function isSideVisible(state: DockState, side: DockSide): boolean {
  return state.tabsBySide[side].length > 0 && !state.hiddenSides.includes(side);
}
