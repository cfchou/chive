export type DocumentTabId = string;

export interface DocumentTab {
  id: DocumentTabId;
  path: string | null;
  label: string;
}

export interface DocumentTabsState {
  order: DocumentTabId[];
  activeId: DocumentTabId | null;
  tabs: Record<DocumentTabId, DocumentTab>;
}

export function createEmptyTabsState(): DocumentTabsState {
  return { order: [], activeId: null, tabs: {} };
}

export function addTab(
  state: DocumentTabsState,
  tab: Omit<DocumentTab, "id">,
): DocumentTabsState {
  const id = crypto.randomUUID();
  const newTab: DocumentTab = { id, ...tab };
  return {
    order: [...state.order, id],
    activeId: state.activeId ?? id,
    tabs: { ...state.tabs, [id]: newTab },
  };
}

export function removeTab(
  state: DocumentTabsState,
  id: DocumentTabId,
): DocumentTabsState {
  const index = state.order.indexOf(id);
  if (index === -1) return state;
  const order = state.order.filter((tabId) => tabId !== id);
  const tabs = { ...state.tabs };
  delete tabs[id];
  let activeId = state.activeId;
  if (activeId === id) {
    activeId = order[index] ?? order[index - 1] ?? null;
  }
  return { order, activeId, tabs };
}

export function activateTab(
  state: DocumentTabsState,
  id: DocumentTabId,
): DocumentTabsState {
  if (!state.order.includes(id)) return state;
  return { ...state, activeId: id };
}

export function moveTab(
  state: DocumentTabsState,
  from: number,
  to: number,
): DocumentTabsState {
  if (from < 0 || from >= state.order.length || to < 0 || to >= state.order.length) {
    return state;
  }
  const order = [...state.order];
  const [id] = order.splice(from, 1);
  order.splice(to, 0, id);
  return { ...state, order };
}

export function nextTabId(state: DocumentTabsState): DocumentTabId | null {
  if (state.order.length === 0 || !state.activeId) return null;
  const index = state.order.indexOf(state.activeId);
  if (index === -1) return state.order[0] ?? null;
  return state.order[(index + 1) % state.order.length];
}

export function previousTabId(state: DocumentTabsState): DocumentTabId | null {
  if (state.order.length === 0 || !state.activeId) return null;
  const index = state.order.indexOf(state.activeId);
  if (index === -1) return state.order[0] ?? null;
  return state.order[(index - 1 + state.order.length) % state.order.length];
}

export function findByPath(
  state: DocumentTabsState,
  path: string | null,
): DocumentTabId | null {
  if (path === null) return null;
  for (const id of state.order) {
    if (state.tabs[id]?.path === path) return id;
  }
  return null;
}
