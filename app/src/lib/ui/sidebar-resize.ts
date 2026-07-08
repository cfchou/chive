import type { SidebarSide } from "./dock-state";

export const SIDEBAR_MIN_WIDTH = 260;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_DEFAULT_WIDTH = 367;

export type SidebarWidths = { left: number; right: number };

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function resizedSidebarWidth(
  side: SidebarSide,
  startWidth: number,
  startX: number,
  currentX: number,
): number {
  const delta = currentX - startX;
  return clampSidebarWidth(side === "left" ? startWidth + delta : startWidth - delta);
}

export function defaultSidebarWidths(): SidebarWidths {
  return { left: SIDEBAR_DEFAULT_WIDTH, right: SIDEBAR_DEFAULT_WIDTH };
}

export function serializeSidebarWidths(widths: SidebarWidths): string {
  return JSON.stringify(widths);
}

export function parseSidebarWidths(raw: string | null): SidebarWidths {
  const defaults = defaultSidebarWidths();
  if (!raw) return defaults;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaults;
    const candidate = parsed as Record<string, unknown>;
    return {
      left: clampSidebarWidth(Number(candidate.left)),
      right: clampSidebarWidth(Number(candidate.right)),
    };
  } catch {
    return defaults;
  }
}
