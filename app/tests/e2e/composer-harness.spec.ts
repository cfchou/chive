// AI Chat Composer behavior that needs context chips present (issue #25 / A3).
//
// Real mode passes no AI Chat Context Chips (real PDF context is post-M1) and
// A3 removed the `?aiChatFixture=` door, so this coverage runs against the
// dev-only harness route that mounts ChatComposer directly inside a
// panel-shaped box. When real context chips arrive post-M1, real-mode e2e
// supersedes this and the harness can go.

import { expect, test } from "./coverage";
import type { Page } from "@playwright/test";

const HARNESS = "/dev/composer-harness";

function composer(page: Page) {
  return page.getByLabel("AI Chat composer");
}
function textarea(page: Page) {
  return page.getByRole("textbox", { name: "Message AI Chat" });
}
function removeChip(page: Page) {
  return page.getByRole("button", { name: "Remove Current page context; use whole document" });
}
function composerHeight(page: Page): Promise<number> {
  return composer(page).evaluate((element) => element.getBoundingClientRect().height);
}

test("context chips add to the composer's initial height, above a two-line text area", async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.getByTestId("composer-harness")).toBeVisible();

  await expect(page.getByText("Current page", { exact: true })).toBeVisible();
  const withChip = await composerHeight(page);

  // The text area still starts at two lines, chips or not.
  const startsAtTwoLines = await textarea(page).evaluate((element) => {
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    return element.getBoundingClientRect().height >= lineHeight * 2 - 1;
  });
  expect(startsAtTwoLines).toBe(true);

  // Removing the chip returns to whole-document mode and gives the height back.
  await removeChip(page).click();
  await expect(page.getByText("Current page", { exact: true })).toHaveCount(0);
  const withoutChip = await composerHeight(page);

  expect(withChip).toBeGreaterThan(withoutChip);
  // The chip row is a real row, not a rounding difference.
  expect(withChip - withoutChip).toBeGreaterThanOrEqual(20);
  await expect(textarea(page)).toHaveAttribute("placeholder", "Ask about this PDF");
});

test("the composer caps at one-third of its panel and scrolls its text internally", async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.getByTestId("composer-harness")).toBeVisible();

  await textarea(page).fill(Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`).join("\n"));

  const grown = await page.getByTestId("harness-panel").evaluate((panel) => {
    const composerElement = panel.querySelector<HTMLElement>('[aria-label="AI Chat composer"]');
    const textareaElement = panel.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message AI Chat"]');
    if (!composerElement || !textareaElement) throw new Error("Missing composer elements");
    return {
      panelHeight: panel.getBoundingClientRect().height,
      composerHeight: composerElement.getBoundingClientRect().height,
      textareaClientHeight: textareaElement.clientHeight,
      textareaScrollHeight: textareaElement.scrollHeight,
      overflowY: getComputedStyle(textareaElement).overflowY,
    };
  });

  expect(Math.abs(grown.composerHeight - grown.panelHeight / 3)).toBeLessThanOrEqual(4);
  expect(grown.textareaScrollHeight).toBeGreaterThan(grown.textareaClientHeight);
  expect(grown.overflowY).toBe("auto");
});

test("the composer's action button becomes Stop while generating", async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.getByTestId("composer-harness")).toBeVisible();

  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await page.getByTestId("toggle-generating").click();

  const stop = page.getByRole("button", { name: "Stop generating" });
  await expect(stop).toBeVisible();
  // Stop is never disabled — it must always be able to cancel.
  await expect(stop).toBeEnabled();
});
