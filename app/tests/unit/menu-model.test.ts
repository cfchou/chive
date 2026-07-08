import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FILE_MENU_ITEMS, type FileMenuItemSpec } from "../../src/lib/tauri/menu-model";

describe("app menu model", () => {
  it("offers document close without window close", () => {
    const fileMenuItems: readonly FileMenuItemSpec[] = FILE_MENU_ITEMS;
    const actionTexts = fileMenuItems.filter((item) => item.kind === "action").map((item) => item.text);
    const predefinedItems = fileMenuItems.filter((item) => item.kind === "predefined").map((item) => item.item);

    assert.deepEqual(actionTexts, ["Open", "Save", "Save As", "Close PDF", "Quit Chive"]);
    assert.equal(predefinedItems.includes("CloseWindow"), false);
  });
});
