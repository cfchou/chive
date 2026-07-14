import { describe, expect, it } from "vitest";

import { SETTINGS_MENU_ITEM } from "$lib/tauri/menu-items";

describe("Settings menu item", () => {
  it("pins the native menu identity, label, and accelerator", () => {
    expect(SETTINGS_MENU_ITEM).toEqual({
      id: "app-settings",
      text: "Settings…",
      accelerator: "CmdOrCtrl+,",
    });
  });
});
