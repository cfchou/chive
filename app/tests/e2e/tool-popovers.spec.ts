import { expect, type Locator, test } from "@playwright/test";
import { collectPageErrors, createFreeText, loadFixture, openApp, pageAnnotations, saveAndReopen } from "./helpers/pdf-spike";

const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  collectPageErrors(page, pageErrors);
  await openApp(page);
  await loadFixture(page);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

async function setRangeValue(locator: Locator, value: number) {
  await locator.evaluate((element: HTMLInputElement, nextValue: number) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("free text font-size popover affects newly created free text", async ({ page }) => {
  await page.getByRole("button", { name: "Free text", exact: true }).click();
  await setRangeValue(page.getByLabel("Font size"), 14);
  await createFreeText(page, "Default free text", 1);

  await page.getByRole("button", { name: "Free text", exact: true }).click();
  await page.getByRole("button", { name: "Free text", exact: true }).click();
  await setRangeValue(page.getByLabel("Font size"), 22);

  await createFreeText(page, "Large free text", 2);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const sizes = [...document.querySelectorAll<HTMLElement>(".freeTextEditor .internal")].map((editor) => ({
          text: editor.innerText.trim(),
          fontSize: Number.parseFloat(getComputedStyle(editor).fontSize),
        }));
        const base = sizes.find((entry) => entry.text.includes("Default free text"))?.fontSize ?? null;
        const large = sizes.find((entry) => entry.text.includes("Large free text"))?.fontSize ?? null;
        return base && large ? large / base : null;
      }),
    )
    .toBeCloseTo(22 / 14, 1);
});

test("ink thickness popover affects newly serialized ink", async ({ page }) => {
  const baseline = (await pageAnnotations(page)).filter((entry) => entry.subtype === "Ink").length;

  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await setRangeValue(page.getByLabel("Ink thickness"), 12);

  await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const layer = document.querySelector(".page[data-page-number=\"1\"] .annotationEditorLayer");
    if (!(layer instanceof HTMLElement)) throw new Error("No annotation editor layer for ink test");
    const rect = layer.getBoundingClientRect();
    const point = (x: number, y: number) => ({
      clientX: Math.round(rect.x + x),
      clientY: Math.round(rect.y + y),
    });
    const dispatch = (type: string, id: number, x: number, y: number, buttons: number) => {
      layer.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: id,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons,
          ...point(x, y),
        }),
      );
    };
    dispatch("pointerdown", 41, 140, 220, 1);
    dispatch("pointermove", 41, 200, 270, 1);
    dispatch("pointermove", 41, 260, 320, 1);
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 41,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
        ...point(260, 320),
      }),
    );
    window.__pdfSpike!.setTool("none");
    await new Promise((resolve) => setTimeout(resolve, 700));
  });

  await saveAndReopen(page, "/tmp/chive-playwright-ink-thickness.pdf");

  const annotations = await pageAnnotations(page);
  const inks = annotations.filter((entry) => entry.subtype === "Ink");
  expect(inks).toHaveLength(baseline + 1);
  expect(inks.some((entry) => (entry.borderStyle?.rawWidth ?? entry.borderStyle?.width) === 12)).toBe(true);
});
