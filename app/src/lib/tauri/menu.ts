import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

type MenuHandlers = {
  openPdf: () => unknown;
  savePdf: () => unknown;
  savePdfAs: () => unknown;
  hasDocument: () => boolean;
};

let saveItem: MenuItem | null = null;
let saveAsItem: MenuItem | null = null;

export async function setupAppMenu(handlers: MenuHandlers) {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return;
  }

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

  const fileMenu = await Submenu.new({
    text: "File",
    items: [
      openItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      saveItem,
      saveAsItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "CloseWindow" }),
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

export async function setPdfMenuDocumentEnabled(enabled: boolean) {
  await Promise.all([saveItem?.setEnabled(enabled), saveAsItem?.setEnabled(enabled)]);
}
