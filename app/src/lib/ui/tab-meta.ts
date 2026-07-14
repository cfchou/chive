import type { SidebarTabId } from "./dock-state";

// Shared by the sidebar tab strips and the tab drag ghost so the dragged
// chip always shows the same glyph as the tab it came from.
export const tabMeta: Record<SidebarTabId, { label: string; icon: string }> = {
  outline: { label: "Outline", icon: "M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10" },
  bookmarks: { label: "Bookmarks", icon: "M7 4h10v16l-5-3-5 3z" },
  annotations: { label: "Annotations", icon: "M4 20h5l10-10a3 3 0 0 0-5-5L4 15zM13 6l5 5" },
  "ai-chat": {
    label: "AI Chat",
    icon: "M5 5h14v10H9l-4 4V5zM8 9h8M8 12h5",
  },
};
