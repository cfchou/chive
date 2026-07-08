export type FileMenuAction = "openPdf" | "savePdf" | "savePdfAs" | "closePdf" | "quitApp";

export type FileMenuItemSpec =
  | {
      kind: "action";
      id: string;
      text: string;
      action: FileMenuAction;
      accelerator?: string;
      documentScoped?: boolean;
    }
  | {
      kind: "separator";
    }
  | {
      kind: "predefined";
      item: "CloseWindow";
    };

export const FILE_MENU_ITEMS = [
  { kind: "action", id: "file-open", text: "Open", accelerator: "CmdOrCtrl+O", action: "openPdf" },
  { kind: "separator" },
  {
    kind: "action",
    id: "file-save",
    text: "Save",
    accelerator: "CmdOrCtrl+S",
    action: "savePdf",
    documentScoped: true,
  },
  {
    kind: "action",
    id: "file-save-as",
    text: "Save As",
    accelerator: "CmdOrCtrl+Shift+S",
    action: "savePdfAs",
    documentScoped: true,
  },
  { kind: "action", id: "file-close-pdf", text: "Close PDF", action: "closePdf", documentScoped: true },
  { kind: "separator" },
  { kind: "action", id: "file-quit", text: "Quit Chive", accelerator: "CmdOrCtrl+Q", action: "quitApp" },
] as const satisfies readonly FileMenuItemSpec[];
