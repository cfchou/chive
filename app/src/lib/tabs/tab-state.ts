// Pure Document Tab model helpers (no pdf.js, no DOM) — unit-testable in
// isolation. The shell holds the live DocumentSession instances; these
// functions operate only on their ids/paths and ordering. See CONTEXT.md for
// "Document Tab" / "Active Document Tab".

export type DocumentTabId = string;

/** Minimal shape shared by DocumentSession for path-based dedupe. */
export interface TabLike {
  id: DocumentTabId;
  path: string | null;
}

/**
 * Find an already-open tab with this exact absolute path (Cmd+O dedupe, D4).
 * Path-less tabs (sample, dropped bytes) never match, and an empty query never
 * matches anything.
 */
export function findTabIdByPath(tabs: readonly TabLike[], path: string): DocumentTabId | null {
  if (!path) return null;
  return tabs.find((tab) => tab.path === path)?.id ?? null;
}

function step(order: readonly DocumentTabId[], activeId: DocumentTabId | null, delta: 1 | -1): DocumentTabId | null {
  if (order.length === 0) return null;
  const index = activeId ? order.indexOf(activeId) : -1;
  if (index === -1) return delta === 1 ? order[0] : order[order.length - 1];
  const next = (index + delta + order.length) % order.length;
  return order[next];
}

/** Next tab with wrap-around; the first tab when nothing/unknown is active. */
export function nextTabId(order: readonly DocumentTabId[], activeId: DocumentTabId | null): DocumentTabId | null {
  return step(order, activeId, 1);
}

/** Previous tab with wrap-around; the last tab when nothing/unknown is active. */
export function previousTabId(order: readonly DocumentTabId[], activeId: DocumentTabId | null): DocumentTabId | null {
  return step(order, activeId, -1);
}

/**
 * Which tab should be active after `closingId` is removed. Closing a non-active
 * tab keeps the active one; closing the active tab selects the nearest right
 * neighbor, else the left; closing the last tab yields null.
 */
export function activeIdAfterClose(
  order: readonly DocumentTabId[],
  closingId: DocumentTabId,
  activeId: DocumentTabId | null,
): DocumentTabId | null {
  const remaining = order.filter((id) => id !== closingId);
  if (remaining.length === 0) return null;
  if (activeId !== closingId) return activeId;
  const closingIndex = order.indexOf(closingId);
  // Nearest right neighbor in the original order, else the new last tab.
  return remaining[Math.min(closingIndex, remaining.length - 1)];
}

/** Reorder `order` by moving the tab at `from` to `to`, clamping both indices. */
export function moveTab(order: readonly DocumentTabId[], from: number, to: number): DocumentTabId[] {
  const next = [...order];
  const clamp = (index: number) => Math.max(0, Math.min(index, next.length - 1));
  const fromIndex = clamp(from);
  const toIndex = clamp(to);
  if (fromIndex === toIndex) return next;
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
