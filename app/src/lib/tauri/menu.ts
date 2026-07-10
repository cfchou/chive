// Native application menu (macOS) for the official app. Installed only inside
// the Tauri runtime; browser dev/test drives open/save through the debug API
// instead, so this module must be a no-op there.
//
// Constraint: replacing the default app menu removes the stock Edit items,
// which kills Cmd+C/V/X and undo in every WKWebView text field (bookmark
// rename, free-text editing). The Edit submenu below restores them — do not
// remove it.

import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

export type AppMenuControls = {
  setSaveEnabled: (enabled: boolean) => Promise<void>;
};

export type AppMenuHandlers = {
  openPdf: () => void | Promise<void>;
  savePdf: () => void | Promise<void>;
  savePdfAs: () => void | Promise<void>;
  closeActiveTab: () => void | Promise<void>;
  showNextTab: () => void | Promise<void>;
  showPreviousTab: () => void | Promise<void>;
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function installAppMenu(handlers: AppMenuHandlers): Promise<AppMenuControls | null> {
  if (!isTauriRuntime()) return null;

  const appSubmenu = await Submenu.new({
    text: "Chive",
    items: [
      await PredefinedMenuItem.new({ item: { About: null } }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Services" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Hide" }),
      await PredefinedMenuItem.new({ item: "HideOthers" }),
      await PredefinedMenuItem.new({ item: "ShowAll" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });

  const saveItem = await MenuItem.new({
    id: "file-save",
    text: "Save",
    accelerator: "CmdOrCtrl+S",
    enabled: false,
    action: () => void handlers.savePdf(),
  });
  const saveAsItem = await MenuItem.new({
    id: "file-save-as",
    text: "Save As…",
    accelerator: "CmdOrCtrl+Shift+S",
    enabled: false,
    action: () => void handlers.savePdfAs(),
  });
  const fileSubmenu = await Submenu.new({
    text: "File",
    items: [
      await MenuItem.new({
        id: "file-open",
        text: "Open…",
        accelerator: "CmdOrCtrl+O",
        action: () => void handlers.openPdf(),
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      saveItem,
      saveAsItem,
    ],
  });

  const editSubmenu = await Submenu.new({
    text: "Edit",
    items: [
      await PredefinedMenuItem.new({ item: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
    ],
  });

  // Cmd+W closes the active Document Tab; closing the last tab leaves the
  // zero-tab empty state, and Cmd+W there closes the window. The stock
  // CloseWindow item is therefore replaced with Close Tab.
  const closeTabItem = await MenuItem.new({
    id: "window-close-tab",
    text: "Close Tab",
    accelerator: "CmdOrCtrl+W",
    action: () => void handlers.closeActiveTab(),
  });
  const previousTabItem = await MenuItem.new({
    id: "window-previous-tab",
    text: "Show Previous Tab",
    accelerator: "CmdOrCtrl+Shift+BracketLeft",
    action: () => void handlers.showPreviousTab(),
  });
  const nextTabItem = await MenuItem.new({
    id: "window-next-tab",
    text: "Show Next Tab",
    accelerator: "CmdOrCtrl+Shift+BracketRight",
    action: () => void handlers.showNextTab(),
  });
  const windowSubmenu = await Submenu.new({
    text: "Window",
    items: [
      await PredefinedMenuItem.new({ item: "Minimize" }),
      await PredefinedMenuItem.new({ item: "Maximize" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      previousTabItem,
      nextTabItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      closeTabItem,
    ],
  });

  const menu = await Menu.new({
    items: [appSubmenu, fileSubmenu, editSubmenu, windowSubmenu],
  });
  await menu.setAsAppMenu();

  return {
    setSaveEnabled: async (enabled: boolean) => {
      await Promise.all([saveItem.setEnabled(enabled), saveAsItem.setEnabled(enabled)]);
    },
  };
}
