import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

type MenuHandlers = {
  openPdf: () => unknown;
  savePdf: () => unknown;
  savePdfAs: () => unknown;
  hasDocument: () => boolean;
};

let saveItem: MenuItem | null = null;
let saveAsItem: MenuItem | null = null;
let quitShortcutInstalled = false;

export async function setupAppMenu(handlers: MenuHandlers) {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return;
  }
  installQuitShortcut();

  const openItem = await MenuItem.new({
    id: "file-open",
    text: "Open",
    accelerator: "CmdOrCtrl+O",
    action: () => void handlers.openPdf(),
  });
  saveItem = await MenuItem.new({
    id: "file-save",
    text: "Save",
    accelerator: "CmdOrCtrl+S",
    enabled: handlers.hasDocument(),
    action: () => {
      if (handlers.hasDocument()) void handlers.savePdf();
    },
  });
  saveAsItem = await MenuItem.new({
    id: "file-save-as",
    text: "Save As",
    accelerator: "CmdOrCtrl+Shift+S",
    enabled: handlers.hasDocument(),
    action: () => {
      if (handlers.hasDocument()) void handlers.savePdfAs();
    },
  });
  const quitItem = await MenuItem.new({
    id: "file-quit",
    text: "Quit Chive",
    accelerator: "CmdOrCtrl+Q",
    action: () => void invoke("quit_app"),
  });

  const fileMenu = await Submenu.new({
    text: "File",
    items: [
      openItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      saveItem,
      saveAsItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "CloseWindow" }),
      quitItem,
    ],
  });

  const editMenu = await Submenu.new({
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

  const menu = await Menu.new({ items: [fileMenu, editMenu] });
  await menu.setAsAppMenu();
}

function installQuitShortcut() {
  if (quitShortcutInstalled) return;
  quitShortcutInstalled = true;

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "q") {
      const testWindow = window as Window & {
        __chiveQuitShortcutCount?: number;
        __chiveSuppressQuitForTest?: boolean;
      };
      if (import.meta.env.VITE_WDIO_TAURI === "1") {
        testWindow.__chiveQuitShortcutCount = (testWindow.__chiveQuitShortcutCount ?? 0) + 1;
        if (testWindow.__chiveSuppressQuitForTest) {
          event.preventDefault();
          return;
        }
      }
      event.preventDefault();
      void invoke("quit_app");
    }
  });
}

export async function setPdfMenuDocumentEnabled(enabled: boolean) {
  await Promise.all([saveItem?.setEnabled(enabled), saveAsItem?.setEnabled(enabled)]);
}
