import { expect, test } from "@playwright/test";
import { loadFixture, waitForPageReady } from "./helpers/pdf-spike";
import { installNavigationSidebarHooks, scrollPdfToOutlineTitle } from "./helpers/navigation-sidebar";

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

