import { type Page, expect, test } from "@playwright/test";
import { type BookmarkEntry, collectPageErrors, openApp } from "./pdf-spike";

export function installNavigationSidebarHooks() {
  const pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors.length = 0;
    collectPageErrors(page, pageErrors);
    await openApp(page);
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });
}

export async function addCurrentPageBookmark(page: Page) {
  await page.evaluate(() => window.__pdfSpike!.createBookmarkForCurrentPage());
}

export async function editBookmarkTitle(page: Page, currentTitle: string, nextTitle: string) {
  await page.locator(".bookmark-title-button").filter({ hasText: currentTitle }).last().dblclick();
  await page.getByRole("textbox", { name: "Bookmark title" }).fill(nextTitle);
  await page.getByRole("textbox", { name: "Bookmark title" }).press("Enter");
}

export async function editLatestBookmarkTitle(page: Page, nextTitle: string) {
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

export async function expectNavHeadingCountInset(page: Page, panelLabel: string, minimumInset: number) {
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

export async function zoomToHorizontalOverflow(page: Page, viewportWidth = 900) {
  // Fixing the viewport (rather than relying on the Playwright project
  // default) makes this deterministic against the app's actual contract: at
  // Fit Width, page width equals container width, so a single 1.1x zoom-in
  // click always overflows it. The loop only guards render-timing, not an
  // uncertain click count.
  await page.setViewportSize({ width: viewportWidth, height: 720 });
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  let overflows = false;
  for (let attempt = 0; attempt < 2 && !overflows; attempt += 1) {
    await zoomIn.click();
    overflows = await page
      .waitForFunction(
        () => {
          const viewer = document.querySelector<HTMLElement>(".pdfViewer");
          return Boolean(viewer && viewer.scrollWidth > viewer.clientWidth);
        },
        undefined,
        { timeout: 2_000 },
      )
      .then(() => true)
      .catch(() => false);
  }
  if (!overflows) {
    const dimensions = await page.evaluate(() => {
      const viewer = document.querySelector<HTMLElement>(".pdfViewer");
      return { clientWidth: viewer?.clientWidth ?? -1, scrollWidth: viewer?.scrollWidth ?? -1 };
    });
    throw new Error(
      `zoom-in did not produce horizontal page overflow at viewport width ${viewportWidth} ` +
        `(pdfViewer clientWidth=${dimensions.clientWidth}, scrollWidth=${dimensions.scrollWidth})`,
    );
  }
}

export async function scrollPdfToOutlineTitle(page: Page, title: string) {
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
