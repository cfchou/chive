import { type Page, expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  type AnnotationEntry,
  type BookmarkEntry,
  collectPageErrors,
  createFreeText,
  createHighlight,
  expectSidebarHasUsefulHighlight,
  loadFixture,
  openApp,
  saveAndReopen,
  waitForPageReady,
} from "./helpers/pdf-spike";

const pageErrors: string[] = [];
const execFileAsync = promisify(execFile);

async function addCurrentPageBookmark(page: Page) {
  await page.evaluate(() => window.__pdfSpike!.createBookmarkForCurrentPage());
}

async function editBookmarkTitle(page: Page, currentTitle: string, nextTitle: string) {
  await page.locator(".bookmark-title-button").filter({ hasText: currentTitle }).last().dblclick();
  await page.getByRole("textbox", { name: "Bookmark title" }).fill(nextTitle);
  await page.getByRole("textbox", { name: "Bookmark title" }).press("Enter");
}

async function editLatestBookmarkTitle(page: Page, nextTitle: string) {
  const currentTitle = await page.evaluate(() => {
    const entries = (window.__pdfSpike!.bookmarkSummary() as BookmarkEntry[]).filter((entry) =>
      entry.id.startsWith("bookmark:"),
    );
    const latest = entries.sort((left, right) => Number(left.id.split(":")[1]) - Number(right.id.split(":")[1])).at(-1);
    return latest?.title;
  });
  if (!currentTitle) {
    throw new Error("Missing latest bookmark title");
  }
  await editBookmarkTitle(page, currentTitle, nextTitle);
}

async function expectNavHeadingCountInset(page: Page, panelLabel: string, minimumInset: number) {
  const inset = await page.evaluate((label) => {
    const panel = document.querySelector<HTMLElement>(`.nav-content[aria-label="${label}"]`);
    const heading = panel?.querySelector<HTMLElement>(".nav-heading");
    const count = heading?.querySelector<HTMLElement>("span:last-child");
    if (!heading || !count) {
      throw new Error(`Missing nav heading count for ${label}`);
    }
    return Math.round(heading.getBoundingClientRect().right - count.getBoundingClientRect().right);
  }, panelLabel);
  expect(inset).toBeGreaterThanOrEqual(minimumInset);
}

async function scrollPdfToOutlineTitle(page: Page, title: string) {
  await page.evaluate((targetTitle) => {
    type OutlineLike = {
      title: string;
      pageNumber: number | null;
      targetY: number | null;
      pageHeight?: number | null;
      items: OutlineLike[];
    };
    const flatten = (entries: OutlineLike[]): OutlineLike[] =>
      entries.flatMap((entry) => [entry, ...flatten(entry.items ?? [])]);
    const entry = flatten(window.__pdfSpike!.outlineSummary() as OutlineLike[]).find((candidate) =>
      candidate.title.startsWith(targetTitle),
    );
    if (!entry?.pageNumber) throw new Error(`Missing outline entry ${targetTitle}`);
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${entry.pageNumber}"]`);
    if (!container || !pageElement) throw new Error(`Missing PDF page ${entry.pageNumber}`);
    const pageHeight = entry.pageHeight ?? pageElement.offsetHeight;
    const targetY = entry.targetY ?? pageHeight;
    const scale = pageHeight > 0 ? pageElement.offsetHeight / pageHeight : 1;
    container.scrollTop = Math.max(0, pageElement.offsetTop + Math.max(0, pageHeight - targetY) * scale - 80);
    container.dispatchEvent(new Event("scroll"));
  }, title);
}

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  collectPageErrors(page, pageErrors);
  await openApp(page);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test("outline sidebar navigates to page two", async ({ page }) => {
  await loadFixture(page);

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.outlineSummary().map((entry: { title: string }) => entry.title),
      ),
    )
    .toContain("1. Networking and Resource Loading");

  await page.getByRole("button", { name: "1. Networking and Resource Loading 2" }).click();
  await expect(page.getByText("Navigated to 1. Networking and Resource Loading.")).toBeVisible();
  await expect(page.getByText("Networking and resource loading pipeline")).toBeVisible();
});

test("outline sidebar displays native outline colors", async ({ page }) => {
  await loadFixture(page, "/colored-outline.pdf", "colored-outline.pdf");

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.outlineSummary().map((entry: { title: string; color?: string | null }) => ({
          title: entry.title,
          color: entry.color,
        })),
      ),
    )
    .toContainEqual({
      title: "Red Outline",
      color: "#f04444",
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.outlineSummary().map((entry: { title: string; color?: string | null }) => ({
          title: entry.title,
          color: entry.color,
        })),
      ),
    )
    .toContainEqual({
      title: "Blue Outline",
      color: "#3b82f6",
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.outlineSummary().map((entry: { title: string; color?: string | null }) => ({
          title: entry.title,
          color: entry.color,
        })),
      ),
    )
    .toContainEqual({
      title: "Default Outline",
      color: null,
    });

  const rowColors = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".outline-item")].reduce<Record<string, string>>((colors, item) => {
      const title = item.querySelector(".outline-title")?.textContent?.trim();
      if (title) {
        const row = item.closest<HTMLElement>(".outline-row-main");
        colors[title] = row ? getComputedStyle(row).backgroundColor : "";
      }
      return colors;
    }, {}),
  );

  expect(rowColors["Red Outline"]).toBe("rgba(240, 68, 68, 0.16)");
  expect(rowColors["Blue Outline"]).toBe("rgba(59, 130, 246, 0.16)");
  expect(rowColors["Default Outline"]).toBe("rgba(0, 0, 0, 0)");
});

test("outline rows with children collapse and expand from chevrons and header icons", async ({ page }) => {
  await loadFixture(page);

  const parentToggle = page.getByRole("button", { name: "Collapse outline item 1. Networking and Resource Loading" });
  const leafToggle = page.getByRole("button", { name: /outline item Speculative Loading and Resource Optimization/ });
  const childRow = page.locator(".outline-item").filter({ hasText: "Speculative Loading and Resource Optimization" });

  await expect(parentToggle).toHaveAttribute("aria-expanded", "true");
  await expect(childRow).toBeVisible();
  await expect(leafToggle).toHaveCount(0);

  const gutterLayout = await page.evaluate(() => {
    const parent = [...document.querySelectorAll<HTMLElement>(".outline-row-main")].find((row) =>
      row.textContent?.includes("1. Networking and Resource Loading"),
    );
    const leaf = [...document.querySelectorAll<HTMLElement>(".outline-row-main")].find((row) =>
      row.textContent?.includes("Speculative Loading and Resource Optimization"),
    );
    if (!parent || !leaf) throw new Error("Missing outline rows");
    return {
      parentColumns: getComputedStyle(parent).gridTemplateColumns,
      leafColumns: getComputedStyle(leaf).gridTemplateColumns,
      leafHasToggle: Boolean(leaf.querySelector(".outline-toggle")),
      leafHasSpacer: Boolean(leaf.querySelector(".outline-toggle-spacer")),
    };
  });
  expect(gutterLayout.parentColumns.startsWith("20px ")).toBe(true);
  expect(gutterLayout.leafColumns.startsWith("20px ")).toBe(true);
  expect(gutterLayout.leafHasToggle).toBe(false);
  expect(gutterLayout.leafHasSpacer).toBe(true);

  await parentToggle.click();
  await expect(page.getByRole("button", { name: "Expand outline item 1. Networking and Resource Loading" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(childRow).toHaveCount(0);

  await page.getByRole("button", { name: "Expand outline item 1. Networking and Resource Loading" }).click();
  await expect(childRow).toBeVisible();

  await page.getByRole("button", { name: "Collapse all outline items" }).click();
  await expect(childRow).toHaveCount(0);
  await expect.poll(() => page.locator(".outline-item").count()).toBeLessThan(54);
  const collapsedLayout = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('.nav-content[aria-label="Outline"]');
    const rows = [...document.querySelectorAll<HTMLElement>(".outline-row-main")];
    if (!nav || rows.length === 0) throw new Error("Missing collapsed outline rows");
    const navRight = nav.getBoundingClientRect().right;
    return rows.map((row) => {
      const pageNumber = row.querySelector<HTMLElement>(".page-number");
      const title = row.querySelector<HTMLElement>(".outline-title");
      const rowRect = row.getBoundingClientRect();
      const isCollapsedParent = row.classList.contains("outline-collapsed-row");
      return {
        rowRight: Math.round(rowRect.right),
        pageRight: pageNumber ? Math.round(pageNumber.getBoundingClientRect().right) : null,
        navRight: Math.round(navRight),
        isCollapsedParent,
        titleOverflows: title ? title.scrollWidth > title.clientWidth : false,
      };
    });
  });
  expect(collapsedLayout.every((row) => row.rowRight <= row.navRight)).toBe(true);
  expect(collapsedLayout.every((row) => row.pageRight === null || row.pageRight <= row.navRight - 32)).toBe(true);
  expect(collapsedLayout.some((row) => row.titleOverflows)).toBe(true);
  const collapsedColorInset = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.nav-content[aria-label="Outline"]');
    const trigger = document.querySelector<HTMLElement>('[aria-label="Outline color 1. Networking and Resource Loading"]');
    if (!panel || !trigger) throw new Error("Missing collapsed outline color trigger");
    return Math.round(panel.getBoundingClientRect().right - trigger.getBoundingClientRect().right);
  });
  expect(collapsedColorInset).toBe(8);

  await page.getByRole("button", { name: "Expand all outline items" }).click();
  await expect(page.locator(".outline-item")).toHaveCount(54);
  await expect(childRow).toBeVisible();
});

test("scrolling PDF dims matching outline row or visible collapsed ancestor", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "3. Styling and Layout 7" }).click();
  await expect(page.getByText("Navigated to 3. Styling and Layout.")).toBeVisible();
  await scrollPdfToOutlineTitle(page, "6. Module Loading and Import Maps");
  await expect
    .poll(() =>
      page
        .locator(".outline-row-main.outline-active .outline-title")
        .allTextContents(),
    )
    .toEqual(["6. Module Loading and Import Maps"]);
  await expect(
    page.locator(".outline-row-main.outline-active .outline-title").filter({ hasText: "3. Styling and Layout" }),
  ).toHaveCount(0);

  await scrollPdfToOutlineTitle(page, "6. Module Loading and Import Maps");
  await expect
    .poll(() =>
      page
        .locator(".outline-row-main.outline-active .outline-title")
        .first()
        .textContent(),
    )
    .toContain("6. Module Loading and Import Maps");

  await page.getByRole("button", { name: "Collapse outline item 5. Inside the JavaScript Engine (V8)" }).click();
  await scrollPdfToOutlineTitle(page, "JIT tiers table");
  await expect
    .poll(() =>
      page
        .locator(".outline-row-main.outline-active .outline-title")
        .first()
        .textContent(),
    )
    .toContain("5. Inside the JavaScript Engine (V8)");
  await expect(page.locator(".outline-item").filter({ hasText: "JIT tiers table" })).toHaveCount(0);
});

test("imported outline color can be edited and persists through native outline color", async ({ page }) => {
  await loadFixture(page, "/colored-outline.pdf", "colored-outline.pdf");

  await page.getByRole("button", { name: "Red Outline 1" }).hover();
  await page.getByRole("button", { name: "Outline color Red Outline" }).click();
  const paletteGeometry = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.nav-content[aria-label="Outline"]');
    const option = document.querySelector<HTMLElement>(".outline-color-option");
    const dot = option?.querySelector<HTMLElement>("span");
    const menu = document.querySelector<HTMLElement>(".outline-color-menu-outline");
    const trigger = document.querySelector<HTMLElement>('[aria-label="Outline color Red Outline"]');
    if (!panel || !option || !dot || !menu || !trigger) throw new Error("Missing outline color picker");
    const panelRight = panel.getBoundingClientRect().right;
    const optionRect = option.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    return {
      optionWidth: Math.round(optionRect.width),
      optionHeight: Math.round(optionRect.height),
      dotWidth: Math.round(dotRect.width),
      dotHeight: Math.round(dotRect.height),
      optionBackground: getComputedStyle(option).backgroundColor,
      triggerRightInset: Math.round(panelRight - triggerRect.right),
      menuRightInset: Math.round(panelRight - menuRect.right),
    };
  });
  expect(paletteGeometry).toEqual({
    optionWidth: 18,
    optionHeight: 18,
    dotWidth: 14,
    dotHeight: 14,
    optionBackground: "rgba(0, 0, 0, 0)",
    triggerRightInset: 8,
    menuRightInset: 8,
  });
  await page.getByRole("button", { name: "Set outline color purple" }).click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.outlineSummary().find((entry: { title: string; color?: string | null }) => entry.title === "Red Outline")
          ?.color,
      ),
    )
    .toBe("#a855f7");

  await page.evaluate(async () => {
    await window.__pdfSpike!.saveToPath("/tmp/pdfspike-playwright-outline-color.pdf");
  });
  const bytes = (await page.evaluate(() =>
    window.__pdfSpike!.debugSavedBytes("/tmp/pdfspike-playwright-outline-color.pdf"),
  )) as number[];
  const savedText = new TextDecoder("latin1").decode(new Uint8Array(bytes));
  expect(savedText).toContain("/C [0.659 0.333 0.969]");

  await page.evaluate(async () => {
    await window.__pdfSpike!.loadPath("/tmp/pdfspike-playwright-outline-color.pdf");
  });
  await waitForPageReady(page);

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.outlineSummary().find((entry: { title: string; color?: string | null }) => entry.title === "Red Outline")
          ?.color,
      ),
    )
    .toBe("#a855f7");
});

test("hovering a nested outline row only reveals that row color chip", async ({ page }) => {
  await loadFixture(page);

  await page.locator(".outline-item").filter({ hasText: "Speculative Loading and Resource Optimization" }).hover();

  const opacities = await page.evaluate(() => {
    const styleFor = (label: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(".outline-color-button")].find(
        (candidate) => candidate.getAttribute("aria-label") === label,
      );
      if (!button) throw new Error(`Missing color button ${label}`);
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return {
        opacity: style.opacity,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        radius: style.borderRadius,
      };
    };
    return {
      parent: styleFor("Outline color 1. Networking and Resource Loading"),
      child: styleFor("Outline color Speculative Loading and Resource Optimization"),
    };
  });

  expect(opacities).toEqual({
    parent: { opacity: "0", width: 16, height: 16, radius: "50%" },
    child: { opacity: "1", width: 16, height: 16, radius: "50%" },
  });
});

test("outline sidebar scrolls all entries and keeps page labels inline", async ({ page }) => {
  await loadFixture(page);

  await expect(page.locator(".outline-item")).toHaveCount(54);

  const layout = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".nav-content");
    const firstItem = document.querySelector<HTMLElement>(".outline-item");
    const firstTitle = firstItem?.querySelector<HTMLElement>(".outline-title");
    const firstPage = firstItem?.querySelector<HTMLElement>(".page-number");
    if (!nav || !firstItem || !firstTitle || !firstPage) {
      throw new Error("Missing outline layout elements");
    }

    const firstTitleRect = firstTitle.getBoundingClientRect();
    const firstPageRect = firstPage.getBoundingClientRect();
    nav.scrollTop = nav.scrollHeight;
    const navRect = nav.getBoundingClientRect();
    const lastVisibleText = [...document.querySelectorAll<HTMLElement>(".outline-item")]
      .filter((item) => {
        const itemRect = item.getBoundingClientRect();
        return itemRect.bottom > navRect.top && itemRect.top < navRect.bottom;
      })
      .at(-1)
      ?.textContent
      ?.trim();

    return {
      canScroll: nav.scrollHeight > nav.clientHeight,
      scrolled: nav.scrollTop > 0,
      firstPageText: firstPage.textContent?.trim(),
      firstPageIsInline: Math.abs(firstTitleRect.top - firstPageRect.top) < 3,
      firstPageIsRightOfTitle: firstPageRect.left >= firstTitleRect.right,
      lastVisibleText,
    };
  });

  expect(layout).toMatchObject({
    canScroll: true,
    scrolled: true,
    firstPageText: "1",
    firstPageIsInline: true,
    firstPageIsRightOfTitle: true,
  });
  expect(layout.lastVisibleText).toContain("Credits");
  expect(layout.lastVisibleText).toContain("23");
});

test("outline sidebar handles PDFs with no outline", async ({ page }) => {
  await loadFixture(page, "/no-outline.pdf", "no-outline.pdf");

  await expect
    .poll(() => page.evaluate(() => window.__pdfSpike!.outlineSummary().length))
    .toBe(0);
  await expect(page.locator(".empty-state", { hasText: "This PDF has no outline." })).toBeVisible();
});

test("outline sidebar keeps valid items when one outline destination is broken", async ({ page }) => {
  await loadFixture(page, "/broken-outline.pdf", "broken-outline.pdf");

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.outlineSummary().map((entry: { title: string; pageNumber: number | null; destinationStatus: string | null }) => ({
          title: entry.title,
          pageNumber: entry.pageNumber,
          destinationStatus: entry.destinationStatus,
        })),
      ),
    )
    .toContainEqual({
      title: "1. Networking and Resource Loading",
      pageNumber: 2,
      destinationStatus: null,
    });

  const brokenButton = page.getByRole("button", { name: /How Modern Browsers Work Destination unavailable/ });
  await expect(brokenButton).toBeDisabled();
  await expect(page.getByText(/not navigable/)).toBeVisible();

  await page.getByRole("button", { name: "1. Networking and Resource Loading 2" }).click();
  await expect(page.getByText("Navigated to 1. Networking and Resource Loading.")).toBeVisible();
  await expect(page.getByText("Networking and resource loading pipeline")).toBeVisible();
});

test("bookmark sidebar creates a current-page bookmark with a page marker", async ({ page }) => {
  await loadFixture(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.outlineSummary().map((entry: { title: string }) => entry.title),
      ),
    )
    .toContain("How Modern Browsers Work");

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  const bookmarksPanel = page.locator('.nav-content[aria-label="Bookmarks"]');
  await expect(bookmarksPanel.locator(".nav-heading")).toContainText("Bookmarks");
  await expect(bookmarksPanel.locator(".nav-heading")).toContainText("0 bookmarks");
  await expectNavHeadingCountInset(page, "Bookmarks", 20);
  await expect(page.getByRole("button", { name: "Add bookmark" })).toBeVisible();
  await page.getByRole("button", { name: "Add bookmark" }).click();
  await expect(page.getByRole("textbox", { name: "Bookmark title" })).toBeVisible();
  await page.getByRole("textbox", { name: "Bookmark title" }).press("Enter");

  await expect(bookmarksPanel.locator(".nav-heading")).toContainText("1 bookmark");
  await expectNavHeadingCountInset(page, "Bookmarks", 20);
  await expect(page.getByRole("button", { name: "How Modern Browsers Work", exact: true })).toBeVisible();
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(1);

  await page.getByRole("tab", { name: "Annotations" }).click();
  const annotationsPanel = page.locator('.nav-content[aria-label="Annotations"]');
  await expect(annotationsPanel.locator(".nav-heading")).toContainText(/\d+ annotations/);
  await expectNavHeadingCountInset(page, "Annotations", 20);
});

test("bookmark title uses the first words from text at an outline destination", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT tiers table 13" }).click();
  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);

  await expect(page.getByRole("button", { name: "TIER NAME ROLE", exact: true })).toBeVisible();
});

test("bookmark title uses the first words from the text line at the anchor", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "Background Compilation 12" }).click();
  await expect(page.getByText("Navigated to Background Compilation.")).toBeVisible();
  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>('.page[data-page-number="12"]');
    const lineSpan = [...document.querySelectorAll<HTMLElement>('.page[data-page-number="12"] .textLayer span')]
      .find((span) => {
        const rect = span.getBoundingClientRect();
        return rect.height > 0 && span.textContent?.replace(/\s+/g, " ").trim().startsWith("Starting with Chrome 66");
      });
    if (!container || !pageElement || !lineSpan) {
      throw new Error("Missing bookmark title text-line fixture");
    }
    const pageRect = pageElement.getBoundingClientRect();
    const lineRect = lineSpan.getBoundingClientRect();
    container.scrollTop = pageElement.offsetTop + lineRect.top - pageRect.top;
  });

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);

  await expect(page.getByRole("button", { name: "Starting with Chrome 66", exact: true })).toBeVisible();
});

test("bookmark title uses the visible page-top heading when multiple outline items share a page", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT Compilation Tiers 12" }).click();
  await expect(page.getByText("Navigated to JIT Compilation Tiers.")).toBeVisible();

  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>('.page[data-page-number="12"]');
    if (!container || !pageElement) {
      throw new Error("Missing page 12 scroll target");
    }
    container.scrollTop = pageElement.offsetTop;
  });
  await expect(
    page.locator('.page[data-page-number="12"]').getByText("Background Compilation", { exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);

  await expect(page.getByRole("button", { name: "Background Compilation", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "JIT Compilation Tiers", exact: true })).toHaveCount(0);
});

test("bookmark row can be renamed inline", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "Renamed bookmark");

  await expect(page.getByRole("button", { name: "Renamed bookmark", exact: true })).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
});

test("existing bookmark can be edited for title and color", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "Original bookmark");

  await expect(page.getByRole("button", { name: "Edit bookmark Original bookmark" })).toHaveCount(0);
  await expect(page.locator(".bookmark-color-chip")).toHaveCount(0);
  await page.getByRole("button", { name: "Original bookmark", exact: true }).dblclick();
  await page.getByRole("button", { name: "Bookmark color Original bookmark" }).click();
  await page.getByRole("button", { name: "Set bookmark color purple" }).click();
  await page.getByRole("textbox", { name: "Bookmark title" }).fill("Edited existing bookmark");
  await page.getByRole("textbox", { name: "Bookmark title" }).press("Enter");
  await page.mouse.move(0, 0);

  await expect(page.getByRole("button", { name: "Edited existing bookmark", exact: true })).toBeVisible();
  await expect(page.locator(".bookmark-page-marker")).toHaveCSS("background-color", "rgb(168, 85, 247)");

  await page.evaluate(async () => {
    await window.__pdfSpike!.saveToPath("/tmp/pdfspike-playwright-existing-bookmark-edit.pdf");
  });
  await page.evaluate(async () => {
    await window.__pdfSpike!.loadPath("/tmp/pdfspike-playwright-existing-bookmark-edit.pdf");
  });
  await waitForPageReady(page);
  await page.getByRole("tab", { name: "Bookmarks" }).click();

  await expect(page.getByRole("button", { name: "Edited existing bookmark", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.bookmarkSummary().find((entry: BookmarkEntry & { color?: string | null }) => entry.title === "Edited existing bookmark")
          ?.color,
      ),
    )
    .toBe("#a855f7");
  await expect(page.getByRole("button", { name: "Edit bookmark Edited existing bookmark" })).toHaveCount(0);
});

test("bookmark title click dims the row without opening the editor", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "First bookmark");
  const clickPoint = await page.evaluate(() => {
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='1']");
    if (!pageElement) throw new Error("Missing page 1 layout");
    const pageRect = pageElement.getBoundingClientRect();
    return {
      x: pageRect.left,
      y: pageRect.top + pageRect.height * 0.35,
    };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await expect(page.getByRole("textbox", { name: "Bookmark title" })).toHaveCount(0);
  await page.locator(".bookmark-title-button").last().click();
  await expect(page.getByRole("textbox", { name: "Bookmark title" })).toHaveCount(0);
  await expect(page.locator(".bookmark-item.bookmark-active")).toHaveCount(1);
  await expect(page.locator(".bookmark-item.bookmark-active")).toHaveCSS("background-color", "rgb(237, 244, 255)");

  await page.locator(".bookmark-title-button").last().dblclick();
  await expect(page.getByRole("textbox", { name: "Bookmark title" })).toBeVisible();

  await page.getByRole("button", { name: "First bookmark", exact: true }).dblclick();

  await expect(page.getByRole("textbox", { name: "Bookmark title" })).toHaveValue("First bookmark");
  await page.getByRole("textbox", { name: "Bookmark title" }).press("Enter");
  await expect(page.getByRole("textbox", { name: "Bookmark title" })).toHaveCount(0);
});

test("bookmark rows are sorted by page anchor when created", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  const scrollPageOneTo = async (fraction: number) =>
    page.evaluate((targetFraction) => {
      const container = document.querySelector<HTMLElement>(".pdf-container");
      const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='1']");
      if (!container || !pageElement) throw new Error("Missing page 1 layout");
      container.scrollTop = pageElement.offsetTop + pageElement.offsetHeight * targetFraction;
    }, fraction);
  const bookmarkRowTitles = async () =>
    (await page.locator(".bookmark-item").allTextContents()).map((text) => text.trim());

  await scrollPageOneTo(0.62);
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "Lower anchor");
  await scrollPageOneTo(0.18);
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "Upper anchor");
  await scrollPageOneTo(0.4);
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "Middle anchor");

  await expect.poll(bookmarkRowTitles).toEqual(["Upper anchor", "Middle anchor", "Lower anchor"]);

  await page.getByRole("button", { name: "Delete bookmark Middle anchor" }).click();

  await expect.poll(bookmarkRowTitles).toEqual(["Upper anchor", "Lower anchor"]);
});

test("bookmark rows are sorted across pages when created", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='2']");
    if (!container || !pageElement) throw new Error("Missing page 2 layout");
    container.scrollTop = pageElement.offsetTop + pageElement.offsetHeight * 0.2;
  });
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().currentPageNumber)).toBe(2);
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "Page 2 anchor");
  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='1']");
    if (!container || !pageElement) throw new Error("Missing page 1 layout");
    container.scrollTop = pageElement.offsetTop + pageElement.offsetHeight * 0.2;
  });
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().currentPageNumber)).toBe(1);
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "Page 1 anchor");

  await expect
    .poll(async () => (await page.locator(".bookmark-item").allTextContents()).map((text) => text.trim()))
    .toEqual(["Page 1 anchor", "Page 2 anchor"]);
});

test("bookmark row can be deleted", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);

  await expect(page.getByRole("button", { name: /Delete bookmark How Modern Browsers Work/ })).toHaveText("⊖");
  const deleteGeometry = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>(".bookmark-row");
    const button = document.querySelector<HTMLElement>(".bookmark-delete");
    if (!row || !button) {
      throw new Error("Missing bookmark delete control");
    }
    const rowRect = row.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      rightInset: Math.round(rowRect.right - buttonRect.right),
      width: Math.round(buttonRect.width),
      height: Math.round(buttonRect.height),
    };
  });
  expect(deleteGeometry).toEqual({ rightInset: 12, width: 24, height: 24 });
  await page.getByRole("button", { name: /Delete bookmark How Modern Browsers Work/ }).click();

  await expect(page.getByRole("button", { name: "How Modern Browsers Work", exact: true })).toHaveCount(0);
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(0);
});

test("bookmark persists after save and reopen", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "Persistent bookmark");

  await saveAndReopen(page, "/tmp/pdfspike-playwright-bookmark.pdf");
  await page.getByRole("tab", { name: "Bookmarks" }).click();

  await expect(page.getByRole("button", { name: "Persistent bookmark", exact: true })).toBeVisible();
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(1);
});

test("deleted bookmark stays deleted after save and reopen", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await saveAndReopen(page, "/tmp/pdfspike-playwright-bookmark-delete.pdf");
  await page.getByRole("tab", { name: "Bookmarks" }).click();

  await page.getByRole("button", { name: /Delete bookmark How Modern Browsers Work/ }).click();
  await saveAndReopen(page, "/tmp/pdfspike-playwright-bookmark-delete.pdf");
  await page.getByRole("tab", { name: "Bookmarks" }).click();

  await expect(page.getByRole("button", { name: "How Modern Browsers Work", exact: true })).toHaveCount(0);
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(0);
});

test("bookmark row navigates after save and reopen", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT tiers table 13" }).click();
  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await saveAndReopen(page, "/tmp/pdfspike-playwright-bookmark-navigation.pdf");
  await page.getByRole("tab", { name: "Bookmarks" }).click();

  await page.getByRole("button", { name: "TIER NAME ROLE", exact: true }).click();

  await expect(page.getByText("Navigated to TIER NAME ROLE.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().currentPageNumber)).toBe(13);
});

test("bookmark row restores the saved page location after reopen", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT tiers table 13" }).click();
  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();
  const targetFraction = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    if (!container || !pageElement) throw new Error("Missing page 13 layout");
    container.scrollTop = pageElement.offsetTop + pageElement.offsetHeight * 0.45;
    return (container.scrollTop - pageElement.offsetTop) / pageElement.offsetHeight;
  });

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "Mid-page bookmark");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-bookmark-location.pdf");
  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    if (container) container.scrollTop = 0;
  });
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await page.getByRole("button", { name: "Mid-page bookmark", exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const container = document.querySelector<HTMLElement>(".pdf-container");
        const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
        if (!container || !pageElement) return -1;
        return (container.scrollTop - pageElement.offsetTop) / pageElement.offsetHeight;
      }),
    )
    .toBeGreaterThan(targetFraction - 0.1);

  const anchorGap = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const marker = document.querySelector<HTMLElement>(".bookmark-page-marker");
    if (!container || !marker) throw new Error("Missing bookmark marker");
    return {
      markerHeight: marker.offsetHeight,
      markerGap: marker.offsetTop - container.scrollTop,
    };
  });
  expect(anchorGap.markerGap).toBeCloseTo(anchorGap.markerHeight, 0);
});

test("bookmark page markers sit on the saved page-rail anchors", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT tiers table 13" }).click();
  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();
  const positions = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    if (!container || !pageElement) throw new Error("Missing page 13 layout");
    const firstTop = pageElement.offsetTop + pageElement.offsetHeight * 0.08;
    const secondTop = pageElement.offsetTop + pageElement.offsetHeight * 0.55;
    container.scrollTop = firstTop;
    return { firstTop, secondTop };
  });
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "First rail anchor");

  await page.evaluate((scrollTop) => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    if (!container) throw new Error("Missing PDF container");
    container.scrollTop = scrollTop;
  }, positions.secondTop);
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "Second rail anchor");

  const markerLayout = await page.evaluate(() => {
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    const markers = [...document.querySelectorAll<HTMLElement>(".bookmark-page-marker")];
    if (!pageElement || markers.length !== 2) throw new Error("Missing rail markers");
    return markers
      .map((marker) => ({
        page: marker.dataset.pageNumber,
        top: marker.offsetTop - pageElement.offsetTop,
        pageHeight: pageElement.offsetHeight,
      }))
      .sort((left, right) => left.top - right.top);
  });

  expect(markerLayout.map((entry) => entry.page)).toEqual(["13", "13"]);
  expect(markerLayout[0].top / markerLayout[0].pageHeight).toBeCloseTo(0.08, 1);
  expect(markerLayout[1].top / markerLayout[1].pageHeight).toBeCloseTo(0.55, 1);
});

test("clicking the page rail creates a bookmark at that anchor", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT tiers table 13" }).click();
  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();
  const clickPoint = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    if (!container || !pageElement) throw new Error("Missing page 13 layout");
    container.scrollTop = pageElement.offsetTop + pageElement.offsetHeight * 0.25;
    const pageRect = pageElement.getBoundingClientRect();
    return {
      x: pageRect.left - 12,
      y: pageRect.top + pageRect.height * 0.42,
    };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(1);
  const markerLayout = await page.evaluate(() => {
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    const marker = document.querySelector<HTMLElement>(".bookmark-page-marker");
    if (!pageElement || !marker) throw new Error("Missing rail marker");
    const styles = getComputedStyle(marker);
    return {
      page: marker.dataset.pageNumber,
      fraction: (marker.offsetTop - pageElement.offsetTop) / pageElement.offsetHeight,
      markerLeft: marker.offsetLeft,
      pageLeft: pageElement.offsetLeft,
      topLeftRadius: styles.borderTopLeftRadius,
      topRightRadius: styles.borderTopRightRadius,
    };
  });
  expect(markerLayout.page).toBe("13");
  expect(markerLayout.fraction).toBeCloseTo(0.42, 1);
  expect(markerLayout.markerLeft).toBe(markerLayout.pageLeft);
  expect(markerLayout.topLeftRadius).toBe("0px");
  expect(markerLayout.topRightRadius).toBe("0px");
});

test("clicking a page-rail bookmark marker removes that bookmark", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT tiers table 13" }).click();
  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();
  const clickPoint = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    if (!container || !pageElement) throw new Error("Missing page 13 layout");
    container.scrollTop = pageElement.offsetTop + pageElement.offsetHeight * 0.25;
    const pageRect = pageElement.getBoundingClientRect();
    return {
      x: pageRect.left - 12,
      y: pageRect.top + pageRect.height * 0.42,
    };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(1);
  await expect(page.locator(".bookmark-row")).toHaveCount(1);

  await page.locator(".bookmark-page-marker").click();

  await expect(page.locator(".bookmark-page-marker")).toHaveCount(0);
  await expect(page.locator(".bookmark-row")).toHaveCount(0);
});

test("clicking the page rail titles the bookmark from the clicked anchor text", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "Painting / Rasterization 9" }).click();
  await expect(page.getByText("Navigated to Painting / Rasterization.")).toBeVisible();
  const clickPoint = await page.evaluate(() => {
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='9']");
    const lineSpan = [...document.querySelectorAll<HTMLElement>(".page[data-page-number='9'] .textLayer span")]
      .find((span) => {
        const rect = span.getBoundingClientRect();
        return rect.height > 0 && span.textContent?.replace(/\s+/g, " ").trim().startsWith("On the renderer's main");
      });
    if (!pageElement || !lineSpan) throw new Error("Missing page 9 anchor line");
    const pageRect = pageElement.getBoundingClientRect();
    const lineRect = lineSpan.getBoundingClientRect();
    return {
      x: pageRect.left - 12,
      y: lineRect.top + lineRect.height / 2,
    };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await expect(page.getByRole("button", { name: "On the renderer's main", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "4. Painting, Compositing, and", exact: true })).toHaveCount(0);
});

test("hovering the page rail shows the add cue at the pointer anchor", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT tiers table 13" }).click();
  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();
  const hoverPoint = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    if (!container || !pageElement) throw new Error("Missing page 13 layout");
    container.scrollTop = pageElement.offsetTop + pageElement.offsetHeight * 0.2;
    const pageRect = pageElement.getBoundingClientRect();
    return {
      x: pageRect.left + 12,
      y: pageRect.top + pageRect.height * 0.37,
    };
  });
  await page.mouse.move(hoverPoint.x, hoverPoint.y);

  const cueLayout = await page.evaluate(() => {
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    const focus = document.querySelector<HTMLElement>(".bookmark-rail-focus-cue");
    const hint = document.querySelector<HTMLElement>(".bookmark-rail-add-cue");
    if (!pageElement || !focus || !hint) return null;
    const focusRect = focus.getBoundingClientRect();
    const hintRect = hint.getBoundingClientRect();
    const focusStyle = getComputedStyle(focus);
    const hintStyle = getComputedStyle(hint);
    return {
      focusBackgroundColor: focusStyle.backgroundColor,
      focusCenterX: focusRect.left + focusRect.width / 2,
      focusCenterY: focusRect.top + focusRect.height / 2,
      focusRadius: focusStyle.borderRadius,
      focusText: focus.textContent?.trim(),
      hintBackgroundColor: hintStyle.backgroundColor,
      hintCenterX: hintRect.left + hintRect.width / 2,
      hintCenterY: hintRect.top + hintRect.height / 2,
      hintRadius: hintStyle.borderRadius,
      hintText: hint.textContent?.trim(),
      pageLeft: pageElement.getBoundingClientRect().left,
    };
  });
  expect(cueLayout).not.toBeNull();
  expect(cueLayout?.focusText).toBe("+");
  expect(cueLayout?.hintText).toBe("+");
  expect(cueLayout?.focusBackgroundColor).toBe("rgb(255, 255, 255)");
  expect(cueLayout?.hintBackgroundColor).toBe("rgb(34, 197, 94)");
  expect(cueLayout?.focusRadius).toBe("999px");
  expect(cueLayout?.hintRadius).toBe("999px");
  expect(Math.abs((cueLayout?.focusCenterX ?? 0) - (cueLayout?.pageLeft ?? 0))).toBeLessThan(2);
  expect(Math.abs((cueLayout?.focusCenterY ?? 0) - hoverPoint.y)).toBeLessThan(2);
  expect((cueLayout?.hintCenterX ?? 0)).toBeGreaterThan(hoverPoint.x);
  expect((cueLayout?.hintCenterY ?? 0)).toBeGreaterThan(hoverPoint.y);
});

test("hovering an existing page-rail bookmark marker DMZ hides the add cue", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(1);

  const dmzPoints = await page.evaluate(() => {
    const marker = document.querySelector<HTMLElement>(".bookmark-page-marker");
    if (!marker) throw new Error("Missing bookmark marker");
    const rect = marker.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    return [
      { x, y: rect.top + rect.height / 2 },
      { x, y: rect.top - rect.height * 0.75 },
      { x, y: rect.bottom + rect.height * 0.75 },
    ];
  });

  for (const point of dmzPoints) {
    await page.mouse.move(point.x, point.y);
    await expect(page.locator(".bookmark-rail-focus-cue")).toHaveCount(0);
    await expect(page.locator(".bookmark-rail-add-cue")).toHaveCount(0);
  }
});

test("bookmark rows and rail markers highlight each other on hover", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "Linked rail marker");

  await page.getByRole("button", { name: "Linked rail marker", exact: true }).hover();
  await expect(page.locator(".bookmark-page-marker.bookmark-hovered")).toHaveCount(1);
  await expect(page.locator(".bookmark-page-marker.bookmark-hovered")).toHaveCSS(
    "background-color",
    "rgb(17, 24, 39)",
  );

  const markerCenter = await page.evaluate(() => {
    const marker = document.querySelector<HTMLElement>(".bookmark-page-marker");
    if (!marker) throw new Error("Missing bookmark marker");
    const rect = marker.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(markerCenter.x, markerCenter.y);
  await expect(page.locator(".bookmark-page-marker")).toHaveCSS("background-color", "rgb(17, 24, 39)");
  await expect(page.locator(".bookmark-item.bookmark-hovered")).toHaveCount(1);
});

test("saved PDF contains a My Bookmarks outline group", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT tiers table 13" }).click();
  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();
  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    if (!container || !pageElement) throw new Error("Missing page 13 layout");
    container.scrollTop = pageElement.offsetTop + pageElement.offsetHeight * 0.45;
  });
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await editLatestBookmarkTitle(page, "qpdf bookmark");
  const bookmarkBeforeSave = (await page.evaluate(() =>
    window.__pdfSpike!.bookmarkSummary().find((entry: BookmarkEntry) => entry.title === "qpdf bookmark"),
  )) as BookmarkEntry | undefined;
  expect(bookmarkBeforeSave).toBeDefined();
  expect(bookmarkBeforeSave!.destinationY).toBeGreaterThan(bookmarkBeforeSave!.targetY);
  await page.evaluate(async () => {
    await window.__pdfSpike!.saveToPath("/tmp/pdfspike-playwright-bookmark-qpdf.pdf");
  });
  const bytes = (await page.evaluate(() =>
    window.__pdfSpike!.debugSavedBytes("/tmp/pdfspike-playwright-bookmark-qpdf.pdf"),
  )) as number[];
  const diskPath = "/tmp/pdfspike-playwright-bookmark-qpdf.pdf";
  await writeFile(diskPath, Buffer.from(bytes));

  const { stdout } = await execFileAsync("qpdf", ["--json", "--json-key=outlines", diskPath]);
  const outlines = JSON.parse(stdout).outlines as { title: string; kids?: { title: string; dest?: unknown[] }[] }[];
  const savedBookmark = outlines[0]?.kids?.find((entry) => entry.title === "qpdf bookmark");

  expect(outlines[0]?.title).toBe("My Bookmarks");
  expect(outlines[0]?.kids?.map((entry) => entry.title)).toContain("qpdf bookmark");
  expect(Number(savedBookmark?.dest?.[3])).toBeCloseTo(bookmarkBeforeSave!.destinationY, 2);
  expect(Number(savedBookmark?.dest?.[3])).toBeGreaterThan(bookmarkBeforeSave!.targetY);

  await page.evaluate(async () => {
    await window.__pdfSpike!.loadPath("/tmp/pdfspike-playwright-bookmark-qpdf.pdf");
  });
  await waitForPageReady(page);
  const bookmarkAfterReopen = (await page.evaluate(() =>
    window.__pdfSpike!.bookmarkSummary().find((entry: BookmarkEntry) => entry.title === "qpdf bookmark"),
  )) as BookmarkEntry | undefined;
  expect(bookmarkAfterReopen?.targetY).toBeCloseTo(bookmarkBeforeSave!.targetY, 1);
});

test("bookmark color can be edited and persists through native outline color", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await expect(page.locator(".bookmark-color-chip")).toHaveCount(0);
  await page.getByRole("button", { name: /Bookmark color/ }).click();
  await expect(page.getByRole("button", { name: "Set bookmark color default" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Set bookmark color pink" })).toBeVisible();
  await expect(page.locator(".bookmark-color-menu .outline-color-option span").first()).toHaveCSS(
    "background-color",
    "rgb(236, 72, 153)",
  );
  await page.getByRole("button", { name: "Set bookmark color blue" }).click();
  await editLatestBookmarkTitle(page, "blue bookmark");
  await page.mouse.move(0, 0);

  await expect(page.getByRole("button", { name: "blue bookmark", exact: true })).toBeVisible();
  await expect(page.locator(".bookmark-page-marker")).toHaveCSS("background-color", "rgb(59, 130, 246)");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.bookmarkSummary().find((entry: BookmarkEntry & { color?: string | null }) => entry.title === "blue bookmark")
          ?.color,
      ),
    )
    .toBe("#3b82f6");

  await page.evaluate(async () => {
    await window.__pdfSpike!.saveToPath("/tmp/pdfspike-playwright-bookmark-color.pdf");
  });
  const bytes = (await page.evaluate(() =>
    window.__pdfSpike!.debugSavedBytes("/tmp/pdfspike-playwright-bookmark-color.pdf"),
  )) as number[];
  const savedText = new TextDecoder("latin1").decode(new Uint8Array(bytes));
  expect(savedText).toContain("/C [0.231 0.510 0.965]");

  await page.evaluate(async () => {
    await window.__pdfSpike!.loadPath("/tmp/pdfspike-playwright-bookmark-color.pdf");
  });
  await waitForPageReady(page);
  await page.getByRole("tab", { name: "Bookmarks" }).click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__pdfSpike!.bookmarkSummary().find((entry: BookmarkEntry & { color?: string | null }) => entry.title === "blue bookmark")
          ?.color,
      ),
    )
    .toBe("#3b82f6");
  await expect(page.locator(".bookmark-page-marker")).toHaveCSS("background-color", "rgb(59, 130, 246)");
});

test("annotation sidebar keeps useful highlight snippets after load and click", async ({ page }) => {
  await loadFixture(page);
  const selectedText = await createHighlight(page);
  await createFreeText(page, "Sidebar regression note");
  await saveAndReopen(page, "/tmp/pdfspike-playwright-sidebar.pdf");

  await expectSidebarHasUsefulHighlight(page);

  const entries = (await page.evaluate(() => window.__pdfSpike!.annotationSidebarSummary())) as AnnotationEntry[];
  expect(entries.some((entry) => entry.kind === "freetext" && entry.detail.includes("Sidebar regression note"))).toBe(
    true,
  );
  expect(entries.some((entry) => entry.kind === "highlight" && entry.detail.includes(selectedText.split(/\s+/)[0]))).toBe(
    true,
  );

  const activated = await page.evaluate(() => window.__pdfSpike!.activateFirstAnnotationItem());
  expect(activated).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().annotationFocusBox)).not.toBeNull();
});

test("annotation sidebar locate focus clears on blank PDF click and Escape", async ({ page }) => {
  await loadFixture(page);

  const activateAndExpectFocus = async () => {
    const activated = await page.evaluate(() => window.__pdfSpike!.activateFirstAnnotationItem());
    expect(activated).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().annotationFocusBox)).not.toBeNull();
  };

  await activateAndExpectFocus();
  const blankPoint = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    if (!container) throw new Error("Missing PDF container");
    (window as Window & { __pdfSpikePointerSeen?: boolean }).__pdfSpikePointerSeen = false;
    container.addEventListener(
      "pointerdown",
      () => {
        (window as Window & { __pdfSpikePointerSeen?: boolean }).__pdfSpikePointerSeen = true;
      },
      { capture: true, once: true },
    );
    const containerRect = container.getBoundingClientRect();
    const xCandidates = [containerRect.left + 20, containerRect.left + 80, containerRect.left + 160];
    const yCandidates = [containerRect.top + 20, containerRect.top + 80, containerRect.top + 160, containerRect.top + 240];
    for (const x of xCandidates) {
      for (const y of yCandidates) {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest(".pdf-container") && !hit.closest(".highlightAnnotation, .freeTextAnnotation, .inkAnnotation")) {
          return { x, y };
        }
      }
    }
    throw new Error("Missing clickable blank PDF container point");
  });
  await page.mouse.click(blankPoint.x, blankPoint.y);
  await expect.poll(() => page.evaluate(() => (window as Window & { __pdfSpikePointerSeen?: boolean }).__pdfSpikePointerSeen)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().annotationFocusBox)).toBeNull();

  await page.getByRole("tab", { name: "Annotations" }).click();
  await page.locator(".annotation-item").first().click();
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().annotationFocusBox)).not.toBeNull();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLElement && active.classList.contains("annotation-item");
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__pdfSpike!.stats().annotationFocusBox)).toBeNull();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLElement && active.classList.contains("annotation-item");
      }),
    )
    .toBe(false);
});

test("annotation sidebar snippets survive repeated fixture loads", async ({ page }) => {
  await loadFixture(page);
  await expectSidebarHasUsefulHighlight(page);

  await loadFixture(page);
  await expectSidebarHasUsefulHighlight(page);
});

test("annotation sidebar locates each persisted ink row after editor mode changes", async ({ page }) => {
  await loadFixture(page);

  const result = await page.evaluate(async () => {
    type SidebarEntry = AnnotationEntry & {
      bounds: { top: number; bottom: number } | null;
      sourceId: string;
    };
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const entries = () => window.__pdfSpike!.annotationSidebarSummary() as SidebarEntry[];
    const pageBounds = (entry: SidebarEntry) => {
      const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
      if (!pageElement || !entry.bounds) throw new Error(`Missing page bounds for ${entry.id}`);
      return {
        top: pageElement.offsetTop + entry.bounds.top * pageElement.offsetHeight,
        bottom: pageElement.offsetTop + entry.bounds.bottom * pageElement.offsetHeight,
      };
    };
    const focusBox = (entry: SidebarEntry) => {
      const stats = window.__pdfSpike!.stats();
      const box = stats.annotationFocusBox as { top: number; height: number } | null;
      if (!box) throw new Error(`Missing focus box; stats=${JSON.stringify(stats)}`);
      return {
        top: box.top,
        bottom: box.top + box.height,
        activeTool: stats.activeTool,
        selectedAnnotationKind: stats.selectedAnnotationKind,
        selectedEditorType: stats.selectedEditorType,
        status: stats.status,
        selectedPersistedAnnotationKey: stats.selectedPersistedAnnotationKey,
        expectedPersistedAnnotationKey: `${entry.page}:${entry.sourceId}`,
      };
    };
    const clickEntry = async (entry: SidebarEntry, expectEditable: boolean) => {
      const row = document.getElementById(`annotation-row-${entry.sourceId}`);
      if (!(row instanceof HTMLElement)) throw new Error(`Annotation row not found for ${entry.id}`);
      row.click();
      const expectedPersistedKey = `${entry.page}:${entry.sourceId}`;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const stats = window.__pdfSpike!.stats();
        if (expectEditable && stats.selectedAnnotationKind === "ink" && stats.selectedPersistedAnnotationKey === expectedPersistedKey) {
          break;
        }
        if (!expectEditable && stats.status === `Located ink on page ${entry.page}.`) {
          break;
        }
        await sleep(150);
      }
      return focusBox(entry);
    };
    const runPair = async (pageNumber: number, firstIndex: number, secondIndex: number) => {
      await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
      await sleep(500);
      [...document.querySelectorAll<HTMLButtonElement>(".nav-tabs button")]
        .find((button) => button.textContent?.trim() === "Annotations")
        ?.click();
      await sleep(300);
      const inks = entries().filter((entry) => entry.page === pageNumber && entry.kind === "ink");
      if (inks.length <= Math.max(firstIndex, secondIndex)) {
        throw new Error(`Expected enough page ${pageNumber} ink rows; entries=${JSON.stringify(inks)}`);
      }
      window.__pdfSpike!.setTool("ink");
      await sleep(500);
      const editableInkSourceIds = new Set(
        window.__pdfSpike!
          .editorSummary()
          .filter((editor: { annotationElementId?: unknown; editorType?: unknown }) => editor.editorType === "ink")
          .map((editor: { annotationElementId?: unknown }) =>
            String(editor.annotationElementId ?? "").replace(/^pdfjs_internal_id_/, ""),
          )
          .filter(Boolean),
      );
      return {
        pageNumber,
        pair: [firstIndex + 1, secondIndex + 1],
        firstInk: await clickEntry(inks[firstIndex], editableInkSourceIds.has(inks[firstIndex].sourceId)),
        secondInk: await clickEntry(inks[secondIndex], editableInkSourceIds.has(inks[secondIndex].sourceId)),
        firstExpected: pageBounds(inks[firstIndex]),
        secondExpected: pageBounds(inks[secondIndex]),
        firstEditable: editableInkSourceIds.has(inks[firstIndex].sourceId),
        secondEditable: editableInkSourceIds.has(inks[secondIndex].sourceId),
      };
    };
    return [await runPair(2, 0, 1), await runPair(2, 1, 2), await runPair(3, 0, 1)];
  });

  for (const pairResult of result) {
    expect(Math.abs(pairResult.firstInk.top - pairResult.firstExpected.top)).toBeLessThan(30);
    expect(Math.abs(pairResult.secondInk.top - pairResult.secondExpected.top)).toBeLessThan(30);
    if (pairResult.firstEditable) {
      expect(pairResult.firstInk.activeTool, JSON.stringify(pairResult)).toBe("ink");
      expect(pairResult.firstInk.selectedAnnotationKind, JSON.stringify(pairResult)).toBe("ink");
      expect(pairResult.firstInk.selectedPersistedAnnotationKey).toBe(pairResult.firstInk.expectedPersistedAnnotationKey);
    } else {
      expect(pairResult.firstInk.status, JSON.stringify(pairResult)).toBe(`Located ink on page ${pairResult.pageNumber}.`);
      expect(pairResult.firstInk.selectedAnnotationKind, JSON.stringify(pairResult)).toBeNull();
    }
    if (pairResult.secondEditable) {
      expect(pairResult.secondInk.activeTool, JSON.stringify(pairResult)).toBe("ink");
      expect(pairResult.secondInk.selectedAnnotationKind, JSON.stringify(pairResult)).toBe("ink");
      expect(pairResult.secondInk.selectedPersistedAnnotationKey).toBe(pairResult.secondInk.expectedPersistedAnnotationKey);
    } else {
      expect(pairResult.secondInk.status, JSON.stringify(pairResult)).toBe(`Located ink on page ${pairResult.pageNumber}.`);
      expect(pairResult.secondInk.selectedAnnotationKind, JSON.stringify(pairResult)).toBeNull();
    }
  }
});

test("annotation sidebar stays synced across load, click, delete, edit, and create", async ({ page }) => {
  const result = await page.evaluate(async () => {
    type SidebarEntry = AnnotationEntry & { source: "live" | "pdf"; sortTop: number; sourceId: string };

    const tab = () =>
      [...document.querySelectorAll<HTMLButtonElement>(".nav-tabs button")].find(
        (button) => button.textContent?.trim() === "Annotations",
      );
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const entries = () => window.__pdfSpike!.annotationSidebarSummary() as SidebarEntry[];
    const waitForUsefulHighlight = async (label: string) => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const highlights = entries().filter((entry) => entry.kind === "highlight");
        const details = highlights.map((entry) => entry.detail);
        const hasPreciseSampleSnippets =
          details.some((detail) => detail.includes("browser's UI thread") && detail.includes("navigation request")) &&
          details.some((detail) => detail.includes("support preconnect and preload directives")) &&
          details.some((detail) => detail.includes("Chrome's CORB") || detail.includes("Cross-Origin Read Blocking"));
        const hasBroadSampleSnippet = details.some((detail) => detail.startsWith("ter a URL or click a link"));
        const hasPartialWordSnippet = details.some((detail) => detail.startsWith("e browser's") || detail.startsWith("ta (Chrome"));
        const allUseful =
          highlights.length >= 3 &&
          highlights.every(
            (entry) =>
              entry.detail &&
              !entry.detail.includes("Persisted PDF annotation") &&
              !entry.detail.includes("Unsaved/live highlight") &&
              /\s/.test(entry.detail.trim()) &&
              Number.isFinite(entry.sortTop) &&
              entry.sortTop < Number.MAX_SAFE_INTEGER,
          ) &&
          hasPreciseSampleSnippets &&
          !hasBroadSampleSnippet &&
          !hasPartialWordSnippet;
        if (allUseful) {
          return { label, highlights: details };
        }
        await sleep(150);
      }
      throw new Error(`${label}: not all highlight snippets useful after load; entries=${JSON.stringify(entries())}`);
    };
    const pageCounts = () => {
      const counts = new Map<number, { total: number; pdf: number; live: number; details: string[] }>();
      for (const entry of entries()) {
        const current = counts.get(entry.page) ?? { total: 0, pdf: 0, live: 0, details: [] };
        current.total += 1;
        current[entry.source] += 1;
        current.details.push(`${entry.source}:${entry.kind}:${entry.detail}`);
        counts.set(entry.page, current);
      }
      return Object.fromEntries(counts);
    };
    const assertPageHeadersMatchEntries = () => {
      const groups: { page: number; count: number }[] = [];
      for (const entry of entries()) {
        const last = groups[groups.length - 1];
        if (last?.page === entry.page) {
          last.count += 1;
        } else {
          groups.push({ page: entry.page, count: 1 });
        }
      }
      const headers = [...document.querySelectorAll(".annotation-page-header")].map((header) =>
        header.textContent?.replace(/\s+/g, " ").trim(),
      );
      const expected = groups.map((group) => `Page ${group.page} ${group.count} item${group.count === 1 ? "" : "s"}`);
      if (headers.length !== expected.length || !expected.every((text, index) => headers[index] === text)) {
        throw new Error(`Annotation page headers mismatch; expected=${JSON.stringify(expected)} actual=${JSON.stringify(headers)}`);
      }
    };
    const textInsideFocusBox = (pageNumber: number) => {
      const box = document.querySelector(".annotation-focus-box");
      if (!(box instanceof HTMLElement)) return "";
      const boxRect = box.getBoundingClientRect();
      const chunks: string[] = [];
      const pdfPage = document.querySelector(`.page[data-page-number="${pageNumber}"]`);
      if (!(pdfPage instanceof HTMLElement)) return "";
      {
        const walker = document.createTreeWalker(pdfPage.querySelector(".textLayer") ?? pdfPage, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          let firstOffset: number | null = null;
          let lastOffset: number | null = null;
          for (let offset = 0; offset < text.length; offset += 1) {
            if (!text[offset]?.trim()) continue;
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            range.detach();
            if (
              rect.width > 0 &&
              rect.height > 0 &&
              boxRect.left - 2 < rect.right &&
              boxRect.right + 2 > rect.left &&
              boxRect.top - 2 < rect.bottom &&
              boxRect.bottom + 2 > rect.top
            ) {
              firstOffset ??= offset;
              lastOffset = offset + 1;
            }
          }
          if (firstOffset !== null && lastOffset !== null) {
            chunks.push(text.slice(firstOffset, lastOffset));
          }
        }
      }
      return chunks.join(" ").replace(/\s+/g, " ").trim();
    };
    const significantTokens = (text: string) =>
      text
        .replace(/[()".,;:—-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 5);
    const assertHighlightRowsPointToFocusedText = async () => {
      for (const entry of entries()) {
        if (entry.source !== "pdf" || entry.kind !== "highlight") continue;
        const row = document.getElementById(`annotation-row-${entry.sourceId}`);
        if (!(row instanceof HTMLElement)) throw new Error(`Could not find annotation row for ${entry.detail}`);
        row.click();
        const expectedTokens = significantTokens(entry.detail);
        let focusText = "";
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await sleep(150);
          focusText = textInsideFocusBox(entry.page);
          const matchingTokens = expectedTokens.filter((token) => focusText.includes(token));
          if (matchingTokens.length >= Math.min(2, expectedTokens.length)) {
            break;
          }
          if (attempt === 19) {
            throw new Error(`Annotation row points to wrong content; expected=${entry.detail}; focus=${focusText}`);
          }
        }
      }
    };
    const clickEntryAndWait = async (predicate: (entry: SidebarEntry) => boolean, selectedKind: string) => {
      const entry = entries().find(predicate);
      if (!entry) throw new Error(`Annotation entry not found; entries=${JSON.stringify(entries())}`);
      const row = document.getElementById(`annotation-row-${entry.sourceId}`);
      if (!(row instanceof HTMLElement)) throw new Error(`Annotation row not found for ${entry.id}`);
      const expectedPersistedKey = entry.source === "pdf" ? `${entry.page}:${entry.sourceId}` : null;
      row.click();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const stats = window.__pdfSpike!.stats();
        if (
          stats.selectedAnnotationKind === selectedKind &&
          (!expectedPersistedKey || stats.selectedPersistedAnnotationKey === expectedPersistedKey)
        ) {
          return;
        }
        await sleep(150);
      }
      throw new Error(`Annotation row did not select ${selectedKind}; stats=${JSON.stringify(window.__pdfSpike!.stats())}`);
    };
    const selectTextOnPage = async (pageNumber: number) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const pdfPage = document.querySelector(`.page[data-page-number="${pageNumber}"]`);
        if (pdfPage instanceof HTMLElement) {
          pdfPage.scrollIntoView({ block: "center" });
          await sleep(250);
          const walker = document.createTreeWalker(pdfPage.querySelector(".textLayer") ?? pdfPage, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const text = node.textContent ?? "";
            const start = text.search(/\S/);
            if (start >= 0 && text.trim().length >= 30) {
              const range = document.createRange();
              range.setStart(node, start);
              range.setEnd(node, Math.min(text.length, start + 30));
              const selection = document.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
              return selection?.toString() ?? "";
            }
          }
        }
        await sleep(150);
      }
      throw new Error(`Could not select text on page ${pageNumber}`);
    };
    const createHighlightSelectionOnPage = async (pageNumber: number) => {
      await selectTextOnPage(pageNumber);
      const created = await window.__pdfSpike!.createSelectionHighlightInToolMode();
      if (!created) throw new Error(`Could not create highlight on page ${pageNumber}`);
      tab()?.click();
      await sleep(500);
    };

    tab()?.click();
    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    const first = await waitForUsefulHighlight("first load with annotations tab already selected");
    assertPageHeadersMatchEntries();
    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    const second = await waitForUsefulHighlight("second load with annotations tab still selected");
    assertPageHeadersMatchEntries();

    const beforeClick = entries();
    await window.__pdfSpike!.activateFirstAnnotationItem();
    await sleep(800);
    const afterClick = entries();
    const liveMirrors = afterClick.filter(
      (entry) => entry.source === "live" && beforeClick.some((before) => before.page === entry.page),
    );
    if (afterClick.length !== beforeClick.length || liveMirrors.length > 0) {
      throw new Error(`Clicking persisted annotation should not add live mirror rows; before=${beforeClick.length} after=${afterClick.length} live=${JSON.stringify(liveMirrors)}`);
    }
    await assertHighlightRowsPointToFocusedText();

    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("delete sync sample reload");
    const beforeDeleteCounts = pageCounts();
    await clickEntryAndWait((entry) => entry.page === 2 && entry.kind === "highlight", "highlight");
    if (!window.__pdfSpike!.deleteSelected()) throw new Error("Delete selected returned false");
    await sleep(300);
    const afterDeleteCounts = pageCounts();
    if (afterDeleteCounts[2]?.total !== beforeDeleteCounts[2]?.total - 1) {
      throw new Error(`Deleting page-2 highlight must reduce page-2 count; before=${JSON.stringify(beforeDeleteCounts)} after=${JSON.stringify(afterDeleteCounts)}`);
    }
    if (afterDeleteCounts[2]?.details.some((detail) => detail.includes("browser process"))) {
      throw new Error(`Deleted page-2 highlight still appears in sidebar; after=${JSON.stringify(afterDeleteCounts)}`);
    }

    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("keyboard delete sync sample reload");
    const beforeKeyboardDeleteCounts = pageCounts();
    await clickEntryAndWait((entry) => entry.page === 2 && entry.kind === "highlight", "highlight");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Delete", code: "Delete", bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const counts = pageCounts();
      if (counts[2]?.total === beforeKeyboardDeleteCounts[2]?.total - 1 && !counts[2]?.details.some((detail) => detail.includes("browser process"))) {
        break;
      }
      if (attempt === 29) {
        throw new Error(`Keyboard Delete must remove page-2 highlight from sidebar without tool switch; before=${JSON.stringify(beforeKeyboardDeleteCounts)} after=${JSON.stringify(counts)} stats=${JSON.stringify(window.__pdfSpike!.stats())}`);
      }
      await sleep(100);
    }

    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("edit sync sample reload");
    const beforeEditCounts = pageCounts();
    await clickEntryAndWait((entry) => entry.page === 2 && entry.kind === "freetext", "freetext");
    const edited = await window.__pdfSpike!.editSelectedFreeText("Synced free text row");
    await sleep(1000);
    const afterEditCounts = pageCounts();
    if (!edited) throw new Error("Edit selected free text returned false");
    if (afterEditCounts[2]?.total !== beforeEditCounts[2]?.total) {
      throw new Error(`Editing page-2 free text must keep page-2 count stable; before=${JSON.stringify(beforeEditCounts)} after=${JSON.stringify(afterEditCounts)}`);
    }
    if (!afterEditCounts[2]?.details.some((detail) => detail.includes("Synced free text row"))) {
      throw new Error(`Edited free text does not appear in sidebar; after=${JSON.stringify(afterEditCounts)}`);
    }

    await window.__pdfSpike!.loadUrl("/sample.pdf", "sample.pdf");
    await waitForUsefulHighlight("create sync sample reload");
    const beforeNewHighlightCounts = pageCounts();
    await createHighlightSelectionOnPage(5);
    const afterNewHighlightCounts = pageCounts();
    if (afterNewHighlightCounts[2]?.total !== beforeNewHighlightCounts[2]?.total) {
      throw new Error(`Adding a page-5 highlight must not duplicate page-2 rows; before=${JSON.stringify(beforeNewHighlightCounts)} after=${JSON.stringify(afterNewHighlightCounts)}`);
    }
    if ((afterNewHighlightCounts[5]?.total ?? 0) !== (beforeNewHighlightCounts[5]?.total ?? 0) + 1) {
      throw new Error(`Expected one new page-5 annotation; before=${JSON.stringify(beforeNewHighlightCounts)} after=${JSON.stringify(afterNewHighlightCounts)}`);
    }

    return { first, second, afterClickCount: afterClick.length };
  });

  expect(result.afterClickCount).toBeGreaterThan(0);
});
