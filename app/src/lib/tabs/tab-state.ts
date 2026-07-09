export type DocumentTabId = string;

export type DocumentTab = {
  id: DocumentTabId;
  path: string | null;
  label: string;
};

export type DocumentTabsState = {
  order: DocumentTabId[];
  tabs: Record<DocumentTabId, DocumentTab>;
  activeId: DocumentTabId | null;
};

function cloneTabsState(state: DocumentTabsState): DocumentTabsState {
  return {
    order: [...state.order],
    tabs: { ...state.tabs },
    activeId: state.activeId,
  };
}

export function addTab(state: DocumentTabsState, tab: DocumentTab): DocumentTabsState {
  const next = cloneTabsState(state);
  if (!next.order.includes(tab.id)) {
    next.order.push(tab.id);
  }
  next.tabs[tab.id] = tab;
  next.activeId = tab.id;
  return next;
}

export function activateTab(state: DocumentTabsState, id: DocumentTabId): DocumentTabsState {
  if (!state.tabs[id]) return state;
  return { ...state, activeId: id };
}

export function removeTab(state: DocumentTabsState, id: DocumentTabId): DocumentTabsState {
  if (!state.tabs[id]) return state;
  const next = cloneTabsState(state);
  const removedIndex = next.order.indexOf(id);
  next.order = next.order.filter((candidate) => candidate !== id);
  delete next.tabs[id];

  if (next.activeId === id) {
    next.activeId = next.order[removedIndex] ?? next.order[removedIndex - 1] ?? null;
  }

  return next;
}

export function moveTab(state: DocumentTabsState, fromIndex: number, toIndex: number): DocumentTabsState {
  if (fromIndex < 0 || fromIndex >= state.order.length) return state;
  if (toIndex < 0 || toIndex >= state.order.length) return state;
  if (fromIndex === toIndex) return state;

  const next = cloneTabsState(state);
  const [id] = next.order.splice(fromIndex, 1);
  next.order.splice(toIndex, 0, id);
  return next;
}

export function nextTabId(
  state: DocumentTabsState,
  fromId: DocumentTabId | null = state.activeId,
): DocumentTabId | null {
  return adjacentTabId(state, fromId, 1);
}

export function previousTabId(
  state: DocumentTabsState,
  fromId: DocumentTabId | null = state.activeId,
): DocumentTabId | null {
  return adjacentTabId(state, fromId, -1);
}

function adjacentTabId(
  state: DocumentTabsState,
  fromId: DocumentTabId | null,
  direction: 1 | -1,
): DocumentTabId | null {
  if (!fromId || state.order.length === 0) return null;
  const index = state.order.indexOf(fromId);
  if (index < 0) return null;
  const nextIndex = (index + direction + state.order.length) % state.order.length;
  return state.order[nextIndex] ?? null;
}

export function findByPath(state: DocumentTabsState, path: string | null): DocumentTabId | null {
  if (!path) return null;
  for (const id of state.order) {
    if (state.tabs[id]?.path === path) return id;
  }
  return null;
}
