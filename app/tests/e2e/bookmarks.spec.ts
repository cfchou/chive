import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { type BookmarkEntry, loadFixture, saveAndReopen, waitForPageReady } from "./helpers/pdf-spike";
import {
  addCurrentPageBookmark,
  editLatestBookmarkTitle,
  expectNavHeadingCountInset,
  installNavigationSidebarHooks,
} from "./helpers/navigation-sidebar";

const execFileAsync = promisify(execFile);

installNavigationSidebarHooks();

test("bookmarks tab lists a created bookmark with a page marker", async ({ page }) => {
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
  // Bookmark creation is rail-only in the official app: there is no sidebar
  // Add button, so this test creates through the debug API instead.
  await expect(page.getByRole("button", { name: "Add bookmark" })).toHaveCount(0);
  await addCurrentPageBookmark(page);

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

  // Anchored at the outline destination line itself; before issue #7's
  // offsetParent fix the anchor mapped one text line low ("TIER NAME ROLE").
  await expect(page.getByRole("button", { name: "JIT tiers table", exact: true })).toBeVisible();
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
  await expect(page.getByLabel("Unsaved changes")).toBeVisible();
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
  // The active row renders a visible tint (token-derived; not pinned to a hex
  // like the spike's #edf4ff — the official design computes it via color-mix).
  await expect(page.locator(".bookmark-item.bookmark-active")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

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

  await page.getByRole("button", { name: "JIT tiers table", exact: true }).click();

  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();
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

test("clicking an existing page-rail bookmark marker DMZ does not create a bookmark", async ({ page }) => {
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
      { x, y: rect.top - rect.height * 0.75 },
      { x, y: rect.bottom + rect.height * 0.75 },
    ];
  });

  for (const point of dmzPoints) {
    await page.mouse.click(point.x, point.y);
    await expect(page.locator(".bookmark-page-marker")).toHaveCount(1);
    await expect(page.locator(".bookmark-row")).toHaveCount(1);
    await expect(page.locator(".bookmark-rail-focus-cue")).toHaveCount(0);
    await expect(page.locator(".bookmark-rail-add-cue")).toHaveCount(0);
  }
});

test("page-rail bookmark marker DMZ accounts for the marker that would be created", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT tiers table 13" }).click();
  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();
  const railPoints = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    if (!container || !pageElement) throw new Error("Missing page 13 layout");
    container.scrollTop = pageElement.offsetTop + pageElement.offsetHeight * 0.2;
    const pageRect = pageElement.getBoundingClientRect();
    return [
      { x: pageRect.left - 12, y: pageRect.top + pageRect.height * 0.25 },
      { x: pageRect.left - 12, y: pageRect.top + pageRect.height * 0.55 },
    ];
  });
  for (const point of railPoints) {
    await page.mouse.click(point.x, point.y);
  }
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(2);

  const candidatePoint = await page.evaluate(() => {
    const markers = [...document.querySelectorAll<HTMLElement>(".bookmark-page-marker")].sort(
      (left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top,
    );
    const lowerRect = markers[1]?.getBoundingClientRect();
    if (!lowerRect) throw new Error("Missing lower bookmark marker");
    const focusCueRadius = 11;
    return {
      x: lowerRect.left + lowerRect.width / 2,
      y: lowerRect.top - lowerRect.height - focusCueRadius - 1,
    };
  });

  await page.mouse.move(candidatePoint.x, candidatePoint.y);
  await expect(page.locator(".bookmark-rail-focus-cue")).toHaveCount(0);
  await expect(page.locator(".bookmark-rail-add-cue")).toHaveCount(0);

  await page.mouse.click(candidatePoint.x, candidatePoint.y);
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(2);
  await expect(page.locator(".bookmark-row")).toHaveCount(2);
});

test("rapid page-rail clicks cannot create bookmark markers closer than one marker height", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT tiers table 13" }).click();
  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();
  const clickPoints = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    if (!container || !pageElement) throw new Error("Missing page 13 layout");
    container.scrollTop = pageElement.offsetTop + pageElement.offsetHeight * 0.2;
    const pageRect = pageElement.getBoundingClientRect();
    const firstY = pageRect.top + pageRect.height * 0.25;
    return [
      { x: pageRect.left - 12, y: firstY },
      { x: pageRect.left - 12, y: firstY + 38 },
    ];
  });

  for (const point of clickPoints) {
    await page.mouse.click(point.x, point.y);
  }

  await expect(page.locator(".bookmark-page-marker")).toHaveCount(1);
  await expect(page.locator(".bookmark-row")).toHaveCount(1);
});

test("clicking the visible page-rail add cue creates a bookmark at that cue", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(1);

  const hoverPoint = await page.evaluate(() => {
    const marker = document.querySelector<HTMLElement>(".bookmark-page-marker");
    if (!marker) throw new Error("Missing bookmark marker");
    const rect = marker.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.bottom + rect.height * 4,
    };
  });
  await page.mouse.move(hoverPoint.x, hoverPoint.y);
  await expect(page.locator(".bookmark-rail-add-cue")).toHaveCount(1);

  const addCueCenter = await page.evaluate(() => {
    const cue = document.querySelector<HTMLElement>(".bookmark-rail-add-cue");
    if (!cue) throw new Error("Missing bookmark add cue");
    const rect = cue.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  await page.mouse.click(addCueCenter.x, addCueCenter.y);
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(2);
  await expect(page.locator(".bookmark-row")).toHaveCount(2);
});

test("first visible page-rail add cue below a bookmark can create a bookmark", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await addCurrentPageBookmark(page);
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(1);

  const searchRange = await page.evaluate(() => {
    const marker = document.querySelector<HTMLElement>(".bookmark-page-marker");
    if (!marker) throw new Error("Missing bookmark marker");
    const rect = marker.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      startY: Math.ceil(rect.bottom),
      endY: Math.ceil(rect.bottom + rect.height * 4),
    };
  });
  let candidate: { x: number; y: number } | null = null;
  for (let y = searchRange.startY; y <= searchRange.endY; y += 1) {
    await page.mouse.move(searchRange.x, y);
    if ((await page.locator(".bookmark-rail-add-cue").count()) > 0) {
      candidate = { x: searchRange.x, y };
      break;
    }
  }
  if (!candidate) throw new Error("No visible add cue found below bookmark");

  await page.mouse.click(candidate.x, candidate.y);
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(2);
  await expect(page.locator(".bookmark-row")).toHaveCount(2);
});

test("first available page-rail bookmark gaps are balanced above and below a bookmark", async ({ page }) => {
  await loadFixture(page);

  await page.getByRole("button", { name: "JIT tiers table 13" }).click();
  await expect(page.getByText("Navigated to JIT tiers table.")).toBeVisible();
  const basePoint = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
    if (!container || !pageElement) throw new Error("Missing page 13 layout");
    container.scrollTop = pageElement.offsetTop + pageElement.offsetHeight * 0.2;
    const pageRect = pageElement.getBoundingClientRect();
    return { x: pageRect.left - 12, y: pageRect.top + pageRect.height * 0.35 };
  });
  await page.mouse.click(basePoint.x, basePoint.y);
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(1);

  const baseRect = await page.evaluate(() => {
    const marker = document.querySelector<HTMLElement>(".bookmark-page-marker");
    if (!marker) throw new Error("Missing bookmark marker");
    const rect = marker.getBoundingClientRect();
    return {
      x: rect.left - rect.width,
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      centerY: rect.top + rect.height / 2,
    };
  });

  let belowPoint: { x: number; y: number } | null = null;
  for (let y = Math.ceil(baseRect.bottom); y <= Math.ceil(baseRect.bottom + baseRect.height * 4); y += 1) {
    await page.mouse.move(baseRect.x, y);
    if ((await page.locator(".bookmark-rail-add-cue").count()) > 0) {
      belowPoint = { x: baseRect.x, y };
      break;
    }
  }
  if (!belowPoint) throw new Error("No visible add cue found below bookmark");
  await page.mouse.click(belowPoint.x, belowPoint.y);
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(2);

  let abovePoint: { x: number; y: number } | null = null;
  for (let y = Math.floor(baseRect.top); y >= Math.floor(baseRect.top - baseRect.height * 4); y -= 1) {
    await page.mouse.move(baseRect.x, y);
    if ((await page.locator(".bookmark-rail-add-cue").count()) > 0) {
      abovePoint = { x: baseRect.x, y };
      break;
    }
  }
  if (!abovePoint) throw new Error("No visible add cue found above bookmark");
  await page.mouse.click(abovePoint.x, abovePoint.y);
  await expect(page.locator(".bookmark-page-marker")).toHaveCount(3);

  const gaps = await page.evaluate((baseCenterY) => {
    const markers = [...document.querySelectorAll<HTMLElement>(".bookmark-page-marker")]
      .map((marker) => {
        const rect = marker.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, centerY: rect.top + rect.height / 2 };
      })
      .sort((left, right) => left.top - right.top);
    const baseIndex = markers.reduce(
      (bestIndex, marker, index) =>
        Math.abs(marker.centerY - baseCenterY) < Math.abs(markers[bestIndex].centerY - baseCenterY) ? index : bestIndex,
      0,
    );
    const above = markers[baseIndex - 1];
    const base = markers[baseIndex];
    const below = markers[baseIndex + 1];
    if (!above || !below) throw new Error("Missing balanced bookmark markers");
    return {
      upperGap: Math.round(base.top - above.bottom),
      lowerGap: Math.round(below.top - base.bottom),
    };
  }, baseRect.centerY);
  expect(Math.abs(gaps.upperGap - gaps.lowerGap)).toBeLessThanOrEqual(1);
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
  // Shared row palette (ui-spec): bookmarks offer the same choices as outline
  // rows — a no-color option plus red/orange/yellow/blue/purple.
  await expect(page.getByRole("button", { name: "Set bookmark color default" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set bookmark color orange" })).toBeVisible();
  await expect(page.locator(".bookmark-color-menu .outline-color-option span").nth(1)).toHaveCSS(
    "background-color",
    "rgb(240, 68, 68)",
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

