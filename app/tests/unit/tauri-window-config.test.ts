import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type TauriConfig = {
  app?: {
    windows?: Array<{
      title?: string;
      titleBarStyle?: string;
      hiddenTitle?: boolean;
    }>;
  };
};

describe("Tauri window config", () => {
  it("uses an overlay titlebar so the Document Tab Bar can occupy the titlebar area", () => {
    const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as TauriConfig;
    const mainWindow = config.app?.windows?.[0];

    assert.equal(mainWindow?.title, "Chive");
    assert.equal(mainWindow?.titleBarStyle, "Overlay");
    assert.equal(mainWindow?.hiddenTitle, true);
  });
});
