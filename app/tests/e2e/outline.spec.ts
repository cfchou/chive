import { expect, test } from "@playwright/test";
import { loadFixture, waitForPageReady } from "./helpers/pdf-spike";
import {
  installNavigationSidebarHooks,
  scrollPdfToOutlineTitle,
  zoomToHorizontalOverflow,
} from "./helpers/navigation-sidebar";

installNavigationSidebarHooks();

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

test("outline pages use the scrollable pdf-container as their offsetParent", async ({ page }) => {
  await loadFixture(page);

  // Contract pin for issue #7: pdf.js's scrollIntoView walks offsetParents
  // from each .page and only scrolls if the walk lands on the scrollable
  // .pdf-container. A positioned .pdfViewer (or any positioned wrapper in
  // between) intercepts the walk and silently breaks outline navigation
  // whenever pages overflow horizontally.
  const offsetParent = await page.evaluate(() => {
    const pageElement = document.querySelector<HTMLElement>(".pdfViewer .page");
    if (!pageElement) throw new Error("Missing .page element");
    const parent = pageElement.offsetParent;
    return parent instanceof HTMLElement
      ? { isPdfContainer: parent.classList.contains("pdf-container"), className: parent.className }
      : { isPdfContainer: false, className: String(parent) };
  });
  expect(offsetParent.isPdfContainer, `offsetParent was: ${offsetParent.className}`).toBe(true);
});

test("outline sidebar navigates when zoomed pages overflow horizontally", async ({ page }) => {
  await loadFixture(page);

  // Regression pin for issue #7: zoom in from Fit Width until the laid-out
  // pages are wider than the reader pane; outline navigation used to
  // silently no-op in that state.
  await zoomToHorizontalOverflow(page);

  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    if (!container) throw new Error("Missing .pdf-container");
    container.scrollTop = 0;
  });

  await page.getByRole("button", { name: "3. Styling and Layout 7" }).click();
  await expect(page.getByText("Navigated to 3. Styling and Layout.")).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const container = document.querySelector<HTMLElement>(".pdf-container");
        if (!container) throw new Error("Missing .pdf-container");
        return container.scrollTop;
      }),
    )
    .toBeGreaterThan(0);

  const landing = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const target = document.querySelector<HTMLElement>('.page[data-page-number="7"]');
    if (!container || !target) throw new Error("Missing scroll container or target page");
    return {
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
      pageOffsetTop: target.offsetTop,
    };
  });
  expect(Math.abs(landing.pageOffsetTop - landing.scrollTop)).toBeLessThan(landing.clientHeight);
});

test("outline navigation falls back when pdf.js's own scroll is defeated", async ({ page }) => {
  await loadFixture(page);

  // Pins the goToOutlineEntry fallback wiring end-to-end. The original
  // issue #7 defect was a healthy-looking guard wired to a signal that
  // could never fire (currentPageNumber updates before the DOM scroll), so
  // a unit test on the predicate alone would not notice the wiring rotting
  // again. Recreate the broken state deliberately — positioned .pdfViewer
  // plus horizontal overflow makes pdf.js's scrollIntoView a silent no-op —
  // and prove navigation still lands via the isPageInView fallback.
  await zoomToHorizontalOverflow(page);

  await page.addStyleTag({ content: ".pdfViewer { position: relative !important; }" });
  const offsetParentClass = await page.evaluate(() => {
    const pageElement = document.querySelector<HTMLElement>(".pdfViewer .page");
    const parent = pageElement?.offsetParent;
    return parent instanceof HTMLElement ? parent.className : String(parent);
  });
  expect(offsetParentClass, "style injection failed to re-position .pdfViewer").toContain("pdfViewer");

  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    if (!container) throw new Error("Missing .pdf-container");
    container.scrollTop = 0;
  });

  await page.getByRole("button", { name: "6. Module Loading and Import Maps 14" }).click();
  await expect(page.getByText("Navigated to 6. Module Loading and Import Maps.")).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const container = document.querySelector<HTMLElement>(".pdf-container");
        if (!container) throw new Error("Missing .pdf-container");
        return container.scrollTop;
      }),
    )
    .toBeGreaterThan(0);

  const landing = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    const target = document.querySelector<HTMLElement>('.page[data-page-number="14"]');
    if (!container || !target) throw new Error("Missing scroll container or target page");
    return {
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
      pageOffsetTop: target.offsetTop,
    };
  });
  expect(Math.abs(landing.pageOffsetTop - landing.scrollTop)).toBeLessThan(landing.clientHeight);
});

test("outline sidebar navigates after the window shrinks at fixed zoom", async ({ page }) => {
  await loadFixture(page);

  // Same failure mode as the zoomed variant, reached with zero zoom
  // interaction: the scale stays fixed while the reader pane narrows, so
  // the laid-out pages overflow horizontally.
  await page.setViewportSize({ width: 640, height: 720 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewer = document.querySelector<HTMLElement>(".pdfViewer");
        if (!viewer) throw new Error("Missing .pdfViewer");
        return viewer.scrollWidth > viewer.clientWidth;
      }),
    )
    .toBe(true);

  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".pdf-container");
    if (!container) throw new Error("Missing .pdf-container");
    container.scrollTop = 0;
  });

  await page.getByRole("button", { name: "3. Styling and Layout 7" }).click();
  await expect(page.getByText("Navigated to 3. Styling and Layout.")).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const container = document.querySelector<HTMLElement>(".pdf-container");
        if (!container) throw new Error("Missing .pdf-container");
        return container.scrollTop;
      }),
    )
    .toBeGreaterThan(0);
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
  // A wide sidebar can fit every fixture title without truncating, so this
  // asserts the truncation mechanism itself (rather than relying on some
  // row's title happening to overflow at the current sidebar width).
  const titleTruncationStyle = await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>(".outline-row-main .outline-title");
    if (!title) throw new Error("Missing outline title");
    const style = getComputedStyle(title);
    return { overflow: style.overflow, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace };
  });
  expect(titleTruncationStyle).toEqual({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
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

