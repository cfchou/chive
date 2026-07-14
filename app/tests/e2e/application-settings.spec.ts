import { expect, test } from "./coverage";
import { createFreeText, loadFixture, openApp } from "./helpers/pdf-spike";

const settingsDialog = (page: Parameters<typeof openApp>[0]) =>
  page.locator("dialog.application-settings-modal");

test.describe("Application Settings", () => {
  test("the production surface opens as an empty modal through the debug seam", async ({ page }) => {
    await openApp(page);

    await page.evaluate(() => window.__pdfSpike!.settings.open());

    const dialog = settingsDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-labelledby", "application-settings-title");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(dialog.getByText("No settings available", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(dialog.getByRole("navigation")).toHaveCount(0);
    await expect(dialog.getByRole("toolbar")).toHaveCount(0);
    await expect(page.locator(".toolbar").getByRole("button", { name: /settings/i })).toHaveCount(0);
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  });

  test("the test fixture opens with its first setting focused", async ({ page }) => {
    await openApp(page);

    await page.evaluate(() => window.__pdfSpike!.settings.open({ fixture: true }));

    const dialog = settingsDialog(page);
    await expect(dialog.locator("section")).toHaveCount(1);
    await expect(dialog.getByRole("heading", { name: "Test fixture" })).toBeVisible();
    const input = dialog.getByRole("textbox", { name: "Example setting" });
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("Initial value");
    await expect(input).toBeFocused();
  });

  test("Save commits the fixture value for the next open", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.__pdfSpike!.settings.open({ fixture: true }));

    const dialog = settingsDialog(page);
    const input = dialog.getByRole("textbox", { name: "Example setting" });
    await input.fill("Saved value");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    await page.evaluate(() => window.__pdfSpike!.settings.open({ fixture: true }));
    await expect(settingsDialog(page).getByRole("textbox", { name: "Example setting" })).toHaveValue(
      "Saved value",
    );
  });

  test("Cancel, Close Settings, and Escape discard a fixture draft", async ({ page }) => {
    await openApp(page);
    const dismissals = [
      () => settingsDialog(page).getByRole("button", { name: "Cancel" }).click(),
      () => settingsDialog(page).getByRole("button", { name: "Close Settings" }).click(),
      () => page.keyboard.press("Escape"),
    ];

    for (const dismiss of dismissals) {
      await page.evaluate(() => window.__pdfSpike!.settings.open({ fixture: true }));
      await settingsDialog(page).getByRole("textbox", { name: "Example setting" }).fill("Discard me");
      await dismiss();
      await expect(settingsDialog(page)).toHaveCount(0);

      await page.evaluate(() => window.__pdfSpike!.settings.open({ fixture: true }));
      await expect(settingsDialog(page).getByRole("textbox", { name: "Example setting" })).toHaveValue(
        "Initial value",
      );
      await settingsDialog(page).getByRole("button", { name: "Cancel" }).click();
    }
  });

  test("closing Settings restores focus to the prior control", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    const zoomIn = page.getByRole("button", { name: "Zoom in" });
    await zoomIn.focus();
    await expect(zoomIn).toBeFocused();

    await page.evaluate(() => window.__pdfSpike!.settings.open());
    await settingsDialog(page).getByRole("button", { name: "Close Settings" }).click();

    await expect(zoomIn).toBeFocused();
  });

  test("repeated open keeps one modal and refocuses its first setting", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.__pdfSpike!.settings.open({ fixture: true }));
    const dialog = settingsDialog(page);
    await dialog.getByRole("button", { name: "Cancel" }).focus();

    await page.evaluate(() => window.__pdfSpike!.settings.open({ fixture: true }));

    await expect(dialog).toHaveCount(1);
    await expect(dialog.getByRole("textbox", { name: "Example setting" })).toBeFocused();
  });

  test("Cmd+W discards Settings before it can close the Active Document Tab", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    const tabsBefore = await page.evaluate(() => window.__pdfSpike!.tabs.list());
    await page.evaluate(() => window.__pdfSpike!.settings.open({ fixture: true }));
    await settingsDialog(page).getByRole("textbox", { name: "Example setting" }).fill("Discard me");

    await page.keyboard.press("Meta+w");

    await expect(settingsDialog(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__pdfSpike!.tabs.list())).toEqual(tabsBefore);
    await page.evaluate(() => window.__pdfSpike!.settings.open({ fixture: true }));
    await expect(settingsDialog(page).getByRole("textbox", { name: "Example setting" })).toHaveValue(
      "Initial value",
    );
  });

  test("Cmd+, opens production Settings in the browser", async ({ page }) => {
    await openApp(page);

    await page.keyboard.press("Meta+,");

    await expect(settingsDialog(page)).toBeVisible();
    await expect(settingsDialog(page).getByText("No settings available", { exact: true })).toBeVisible();
  });

  test("an unsaved-changes prompt replaces an open Settings modal", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    await createFreeText(page, "dirty document");
    await page.evaluate(() => window.__pdfSpike!.settings.open({ fixture: true }));
    await settingsDialog(page).getByRole("textbox", { name: "Example setting" }).fill("Discard me");

    await page.evaluate(() => {
      const active = window.__pdfSpike!.tabs.list().find((tab: { active: boolean }) => tab.active);
      if (!active) throw new Error("Expected an Active Document Tab");
      void window.__pdfSpike!.tabs.close(active.id, { force: false });
    });

    await expect(settingsDialog(page)).toHaveCount(0);
    await expect(page.locator("dialog.modal")).toBeVisible();
    await expect(page.locator("dialog:modal")).toHaveCount(1);
  });

  test("tabs.close keeps its force-close default for a dirty Document Tab", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    await createFreeText(page, "force-close compatibility");

    const result = await page.evaluate(async () => {
      const active = window.__pdfSpike!.tabs.list().find((tab: { active: boolean }) => tab.active);
      if (!active) throw new Error("Expected an Active Document Tab");
      return window.__pdfSpike!.tabs.close(active.id);
    });

    expect(result).toBe("closed");
    await expect(page.locator("[data-doc-tab]")).toHaveCount(0);
    await expect(page.locator("dialog.modal")).toHaveCount(0);
  });

  test("Settings cannot open on top of an unsaved-changes prompt", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    await createFreeText(page, "dirty document");
    await page.locator("[data-doc-tab] .doc-tab-close").click();
    await expect(page.locator("dialog.modal")).toBeVisible();

    await page.evaluate(() => window.__pdfSpike!.settings.open({ fixture: true }));

    await expect(settingsDialog(page)).toHaveCount(0);
    await expect(page.locator("dialog:modal")).toHaveCount(1);
  });

  test("Escape closes production Settings before clearing Annotation Focus", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    await createFreeText(page, "selected annotation");
    await page.evaluate(() => window.__pdfSpike!.settings.open());
    await expect(settingsDialog(page).getByRole("button", { name: "Close Settings" })).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(settingsDialog(page)).toHaveCount(0);
  });

  test("Settings hit-tests above the PDF editor layer", async ({ page }) => {
    await openApp(page);
    await loadFixture(page);
    await createFreeText(page, "under Settings");
    await page.evaluate(() => window.__pdfSpike!.settings.open());

    const result = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement>("dialog.application-settings-modal");
      const editorLayer = document.querySelector<HTMLElement>(".annotationEditorLayer");
      if (!dialog || !editorLayer) throw new Error("Expected Settings and the PDF editor layer");
      const modalRect = dialog.getBoundingClientRect();
      const editorRect = editorLayer.getBoundingClientRect();
      const left = Math.max(modalRect.left, editorRect.left);
      const right = Math.min(modalRect.right, editorRect.right);
      const top = Math.max(modalRect.top, editorRect.top);
      const bottom = Math.min(modalRect.bottom, editorRect.bottom);
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return {
        overlaps: right > left && bottom > top,
        hitInsideSettings: Boolean(hit && dialog.contains(hit)),
        hitInsideEditor: Boolean(hit?.closest(".annotationEditorLayer")),
      };
    });

    expect(result).toEqual({ overlaps: true, hitInsideSettings: true, hitInsideEditor: false });
  });
});
