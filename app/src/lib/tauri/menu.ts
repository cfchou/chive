import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { FILE_MENU_ITEMS, type FileMenuAction, type FileMenuItemSpec } from "$lib/tauri/menu-model";

type MenuHandlers = {
  openPdf: () => unknown;
  closePdf: () => unknown;
  savePdf: () => unknown;
  savePdfAs: () => unknown;
  hasDocument: () => boolean;
};

let saveItem: MenuItem | null = null;
let saveAsItem: MenuItem | null = null;
let closeItem: MenuItem | null = null;
let quitShortcutInstalled = false;

export async function setupAppMenu(handlers: MenuHandlers) {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return;
  }
  installQuitShortcut();

  const fileMenu = await Submenu.new({
    text: "File",
    items: await Promise.all(FILE_MENU_ITEMS.map((item) => createFileMenuItem(item, handlers))),
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

async function createFileMenuItem(item: FileMenuItemSpec, handlers: MenuHandlers) {
  if (item.kind === "separator") {
    return PredefinedMenuItem.new({ item: "Separator" });
  }
  if (item.kind === "predefined") {
    return PredefinedMenuItem.new({ item: item.item });
  }

  const menuItem = await MenuItem.new({
    id: item.id,
    text: item.text,
    accelerator: item.accelerator,
    enabled: item.documentScoped ? handlers.hasDocument() : true,
    action: () => performFileMenuAction(item.action, handlers),
  });

  if (item.action === "savePdf") saveItem = menuItem;
  if (item.action === "savePdfAs") saveAsItem = menuItem;
  if (item.action === "closePdf") closeItem = menuItem;
  return menuItem;
}

function performFileMenuAction(action: FileMenuAction, handlers: MenuHandlers) {
  if (action !== "openPdf" && action !== "quitApp" && !handlers.hasDocument()) return;

  switch (action) {
    case "openPdf":
      void handlers.openPdf();
      break;
    case "savePdf":
      void handlers.savePdf();
      break;
    case "savePdfAs":
      void handlers.savePdfAs();
      break;
    case "closePdf":
      void handlers.closePdf();
      break;
    case "quitApp":
      void invoke("quit_app");
      break;
  }
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
  await Promise.all([saveItem?.setEnabled(enabled), saveAsItem?.setEnabled(enabled), closeItem?.setEnabled(enabled)]);
}
