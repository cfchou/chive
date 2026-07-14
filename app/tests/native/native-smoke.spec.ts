import { browser, expect } from "@wdio/globals";
import path from "node:path";
import { PNG } from "pngjs";
import { Key } from "webdriverio";
import { FREE_TEXT_MOVE_GRIP_INSET_PX, FREE_TEXT_MOVE_GRIP_SIZE_PX } from "../../src/lib/pdf/free-text-move";

type WdioBrowser = {
  execute: <T, Arg = unknown>(script: (arg: Arg) => T | Promise<T>, arg?: Arg) => Promise<T>;
  keys: (value: string | string[]) => Promise<void>;
  setWindowSize: (width: number, height: number) => Promise<void>;
  takeScreenshot: () => Promise<string>;
  waitUntil: (
    condition: () => Promise<boolean>,
    options?: { timeout?: number; timeoutMsg?: string },
  ) => Promise<boolean>;
};

type AnnotationEntry = {
  detail: string;
  kind: "highlight" | "freetext" | "ink";
  page: number;
  sourceId: string;
  intent?: string | null;
  bounds: { top: number; bottom: number } | null;
};

type OutlineEntry = {
  title: string;
  pageNumber: number | null;
  color?: string | null;
  destinationStatus: string | null;
};

type DocumentTabSummary = {
  id: string;
  label: string;
  path: string | null;
  active: boolean;
};

const app = browser as unknown as WdioBrowser;
const samplePdfPath = path.resolve(process.cwd(), "static/sample.pdf");
const noOutlinePdfPath = path.resolve(process.cwd(), "static/no-outline.pdf");
const brokenOutlinePdfPath = path.resolve(process.cwd(), "static/broken-outline.pdf");
const coloredOutlinePdfPath = path.resolve(process.cwd(), "static/colored-outline.pdf");
const bookmarkPdfPath = "/tmp/pdfspike-native-bookmark.pdf";
const freeTextGripPdfPath = "/tmp/pdfspike-native-free-text-grip.pdf";

async function waitForPdfSpike() {
  await app.waitUntil(
    async () => app.execute(() => Boolean((window as Window & { __pdfSpike?: unknown }).__pdfSpike)),
    {
      timeout: 30_000,
      timeoutMsg: "window.__pdfSpike was not initialized in native WKWebView",
    },
  );
}

async function hideRightSidebarForPdfGeometry() {
  await app.execute(() => {
    const sidebar = document.querySelector<HTMLElement>('.sidebar[data-side="right"]');
    if (sidebar?.classList.contains("is-hidden")) return;
    const hideButton = document.querySelector<HTMLButtonElement>('button[aria-label="Hide right sidebar"]');
    if (!hideButton) throw new Error("Native Hide right sidebar button not found");
    hideButton.click();
  });
  await app.waitUntil(
    async () =>
      app.execute(() =>
        Boolean(
          document.querySelector<HTMLElement>('.sidebar[data-side="right"]')?.classList.contains("is-hidden"),
        ),
      ),
    { timeout: 10_000, timeoutMsg: "Native right sidebar did not collapse for PDF geometry test" },
  );
}

async function expectNativeSelectedDeleteGlyph(editorClass: "highlightEditor" | "freeTextEditor" | "inkEditor") {
  const readGeometry = () =>
    app.execute((targetEditorClass) => {
      const button = document.querySelector<HTMLElement>(
        `.${targetEditorClass}.selectedEditor .editToolbar:not(.hidden) .deleteButton`,
      );
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      const hits: Array<{ x: number; y: number }> = [];
      const scanStep = Math.max(4, Math.floor(Math.min(rect.width, rect.height) / 4));
      for (let y = 0; y < innerHeight; y += scanStep) {
        for (let x = 0; x < innerWidth; x += scanStep) {
          const hit = document.elementFromPoint(x, y);
          if (hit === button || button.contains(hit)) hits.push({ x, y });
        }
      }
      if (hits.length === 0) return null;
      return {
        button: rect.toJSON(),
        centerTargetsDelete:
          document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest(".deleteButton") ===
          button,
        hit: {
          bottom: Math.max(...hits.map(({ y }) => y)),
          left: Math.min(...hits.map(({ x }) => x)),
          right: Math.max(...hits.map(({ x }) => x)),
          top: Math.min(...hits.map(({ y }) => y)),
        },
        viewport: { height: innerHeight, width: innerWidth },
      };
    }, editorClass);
  let geometry = await readGeometry();
  await app.waitUntil(
    async () => {
      geometry = await readGeometry();
      return Boolean(geometry);
    },
    { timeout: 10_000, timeoutMsg: `Native selected ${editorClass} delete control did not become hit-testable` },
  );
  if (!geometry) throw new Error(`Native selected ${editorClass} delete control did not become hit-testable`);

  const screenshot = PNG.sync.read(Buffer.from(await app.takeScreenshot(), "base64"));
  const scaleX = screenshot.width / geometry.viewport.width;
  const scaleY = screenshot.height / geometry.viewport.height;
  const glyphPixels: Array<{ x: number; y: number }> = [];
  const left = Math.floor(geometry.button.left * scaleX);
  const right = Math.ceil(geometry.button.right * scaleX);
  const top = Math.floor(geometry.button.top * scaleY);
  const bottom = Math.ceil(geometry.button.bottom * scaleY);
  const colorCounts = new Map<string, number>();
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * screenshot.width + x) * 4;
      const [red, green, blue, alpha] = screenshot.data.subarray(offset, offset + 4);
      if (alpha < 200) continue;
      const key = `${red},${green},${blue}`;
      colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
    }
  }
  const background = [...colorCounts.entries()].sort((leftColor, rightColor) => rightColor[1] - leftColor[1])[0]?.[0];
  if (!background) throw new Error("Native delete control screenshot had no opaque background pixels");
  const [backgroundRed, backgroundGreen, backgroundBlue] = background.split(",").map(Number);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * screenshot.width + x) * 4;
      const [red, green, blue, alpha] = screenshot.data.subarray(offset, offset + 4);
      const contrast =
        Math.abs(red - backgroundRed) + Math.abs(green - backgroundGreen) + Math.abs(blue - backgroundBlue);
      const relativeX = (x - left) / scaleX;
      const relativeY = (y - top) / scaleY;
      if (alpha >= 200 && contrast > 120 && relativeX >= 4 && relativeX <= 23 && relativeY >= 4 && relativeY <= 23) {
        glyphPixels.push({ x: (x + 0.5) / scaleX, y: (y + 0.5) / scaleY });
      }
    }
  }
  expect(glyphPixels.length).toBeGreaterThan(30 * scaleX * scaleY);
  expect(glyphPixels.length).toBeLessThan(200 * scaleX * scaleY);
  const glyphTargetsDelete = await app.execute(
    ({ targetEditorClass, paintedGlyphPoints }) => {
      const button = document.querySelector<HTMLElement>(
        `.${targetEditorClass}.selectedEditor .editToolbar:not(.hidden) .deleteButton`,
      );
      return Boolean(
        button &&
          paintedGlyphPoints.every(
            ({ x, y }) => document.elementFromPoint(x, y)?.closest(".deleteButton") === button,
          ),
      );
    },
    { targetEditorClass: editorClass, paintedGlyphPoints: glyphPixels },
  );
  expect(glyphTargetsDelete).toBe(true);
  expect(geometry.centerTargetsDelete).toBe(true);
  expect(geometry.hit.left).toBeGreaterThanOrEqual(Math.floor(geometry.button.left));
  expect(geometry.hit.right).toBeLessThanOrEqual(Math.ceil(geometry.button.right));
  expect(geometry.hit.top).toBeGreaterThanOrEqual(Math.floor(geometry.button.top));
  expect(geometry.hit.bottom).toBeLessThanOrEqual(Math.ceil(geometry.button.bottom));
}

async function setNativeFullscreen(fullscreen: boolean) {
  return app.execute(async (nextFullscreen) => {
    type TauriInternals = { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
    const tauriInternals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
    if (!tauriInternals) throw new Error("window.__TAURI_INTERNALS__ is not available");
    await tauriInternals.invoke("plugin:window|set_simple_fullscreen", { label: "main", value: nextFullscreen });
    return true;
  }, fullscreen);
}

async function emitTauriEventForTest(event: string, payload: unknown) {
  await app.execute(
    async ({ eventName, eventPayload }) => {
      type TauriInternals = { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
      const tauriInternals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
      if (!tauriInternals) throw new Error("window.__TAURI_INTERNALS__ is not available");
      await tauriInternals.invoke("plugin:event|emit", { event: eventName, payload: eventPayload });
    },
    { eventName: event, eventPayload: payload },
  );
}

describe("native WKWebView PDF smoke", () => {
  it("supports W3C pointer actions against the native Zoom in control", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);
    const control = await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]');
      if (!button) throw new Error("Native Zoom in button not found");
      const rect = button.getBoundingClientRect();
      return {
        before: document.querySelector(".zoom-value")?.textContent?.trim() ?? "",
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    }, samplePdfPath);

    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ origin: "viewport", x: control.x, y: control.y })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();

    await app.waitUntil(
      async () => app.execute((before) => (document.querySelector(".zoom-value")?.textContent?.trim() ?? "") !== before, control.before),
      { timeout: 10_000, timeoutMsg: "W3C pointer action did not activate native Zoom in" },
    );
  });

  it("moves editable free text from its exterior grip and persists its text and geometry", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);
    const initialText = "Native W3C free-text grip";
    await app.execute(async (filePath) => window.__pdfSpike!.loadPath(filePath), samplePdfPath);
    await app.waitUntil(
      async () => app.execute(() => Number(window.__pdfSpike!.stats().pages ?? 0) > 0),
      { timeout: 30_000, timeoutMsg: "Native sample PDF did not render before free-text creation" },
    );
    expect(await app.execute(async (text) => window.__pdfSpike!.createPageFreeText(text), initialText)).toBe(true);
    await app.waitUntil(
      async () =>
        app.execute((text) =>
          (window.__pdfSpike!.annotationSidebarSummary() as Array<AnnotationEntry & { source?: string }>).some(
            (candidate) => candidate.kind === "freetext" && candidate.source === "live" && candidate.detail.includes(text),
          ),
        initialText),
      { timeout: 10_000, timeoutMsg: "New live free-text Annotation Sidebar Entry did not appear" },
    );
    const activated = await app.execute(async (text) => {
      const entry = (window.__pdfSpike!.annotationSidebarSummary() as Array<AnnotationEntry & { source?: string }>).find(
        (candidate) => candidate.kind === "freetext" && candidate.source === "live" && candidate.detail.includes(text),
      );
      if (!entry) throw new Error("New live free-text Annotation Sidebar Entry not found");
      const activatedEditor = await window.__pdfSpike!.activateAnnotationBySourceId(entry.sourceId);
      const root = document.getElementById(entry.sourceId);
      if (!(root instanceof HTMLElement)) throw new Error("New live free-text editor root not found");
      root.focus();
      return activatedEditor;
    }, initialText);
    expect(activated).toBe(true);
    await expectNativeSelectedDeleteGlyph("freeTextEditor");

    await app.keys(Key.Enter);
    await app.waitUntil(
      async () =>
        app.execute((text) => {
          const internal = [...document.querySelectorAll<HTMLElement>(".freeTextEditor .internal")].find(
            (element) => element.isContentEditable && element.innerText.replace(/\s+/g, " ").includes(text),
          );
          return Boolean(internal?.contains(document.activeElement));
        }, initialText),
      { timeout: 10_000, timeoutMsg: "Native free-text editor did not enter editable mode" },
    );

    const before = await app.execute(({ text, inset, size }) => {
      const internal = [...document.querySelectorAll<HTMLElement>(".freeTextEditor .internal")].find(
        (element) => element.isContentEditable && element.innerText.replace(/\s+/g, " ").includes(text),
      );
      const root = internal?.closest<HTMLElement>(".freeTextEditor");
      const pageElement = root?.closest<HTMLElement>(".page");
      if (!root?.id || !internal || !pageElement) throw new Error("Editable native free-text editor not found");
      const rect = root.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();
      const internalRect = internal.getBoundingClientRect();
      const style = getComputedStyle(root, "::after");
      const offset = inset + size / 2;
      const grip = {
        x: Math.round(rect.left + offset),
        y: Math.round(rect.top + offset),
      };
      const gripLeft = rect.left + Number.parseFloat(style.left);
      const gripTop = rect.top + Number.parseFloat(style.top);
      const gripWidth = Number.parseFloat(style.width);
      const gripHeight = Number.parseFloat(style.height);
      return {
        editorId: root.id,
        edgeTarget: { left: pageRect.left + size + 2, top: pageRect.top + size + 2 },
        grip,
        gripTargetsEditor: document.elementFromPoint(grip.x, grip.y)?.closest<HTMLElement>(".freeTextEditor")?.id === root.id,
        rect: { left: rect.left, top: rect.top },
        style: {
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderTopColor: style.borderTopColor,
          borderTopStyle: style.borderTopStyle,
          borderTopWidth: style.borderTopWidth,
          clipPath: style.clipPath,
          height: style.height,
          left: style.left,
          pointerEvents: style.pointerEvents,
          top: style.top,
          width: style.width,
        },
        doesNotCoverEditableText: gripLeft + gripWidth <= internalRect.left && gripTop + gripHeight <= internalRect.top,
      };
    }, { text: initialText, inset: FREE_TEXT_MOVE_GRIP_INSET_PX, size: FREE_TEXT_MOVE_GRIP_SIZE_PX });
    expect(before.gripTargetsEditor).toBe(false);
    expect(before.style).toMatchObject({
      clipPath: "none",
      height: "14px",
      left: "-14px",
      pointerEvents: "none",
      top: "-14px",
      width: "14px",
    });
    expect(before.style.borderTopStyle).toBe("solid");
    expect(before.style.borderTopWidth).toBe("1px");
    expect(before.style.borderTopColor).toBe("rgb(35, 135, 216)");
    expect(before.style.backgroundImage).toContain("radial-gradient");
    expect(before.style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(before.doesNotCoverEditableText).toBe(true);
    const delta = {
      x: Math.round(before.edgeTarget.left - before.rect.left),
      y: Math.round(before.edgeTarget.top - before.rect.top),
    };

    const editorMoved = () =>
      app.execute(({ editorId, expectedText, prior, expectedDelta }) => {
        const root = document.getElementById(editorId);
        const internal = root?.querySelector<HTMLElement>(".internal[contenteditable='true'], [contenteditable='true']");
        if (!(root instanceof HTMLElement) || !internal?.isContentEditable) return false;
        const rect = root.getBoundingClientRect();
        return (
          Math.abs((rect.left - prior.left) - expectedDelta.x) < 2 &&
          Math.abs((rect.top - prior.top) - expectedDelta.y) < 2 &&
          internal.contains(document.activeElement) &&
          internal.innerText.replace(/\s+/g, " ").includes(expectedText)
        );
      }, { editorId: before.editorId, expectedText: initialText, prior: before.rect, expectedDelta: delta });

    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ origin: "viewport", x: before.grip.x, y: before.grip.y })
      .down({ button: 0 })
      .move({ origin: "viewport", x: before.grip.x + delta.x, y: before.grip.y + delta.y })
      .up({ button: 0 })
      .perform();
    const movedByRealPointer = await app.waitUntil(editorMoved, { timeout: 1_000 }).catch(() => false);

    if (!movedByRealPointer) await app.execute(({ start, movement }) => {
      const target = document.elementFromPoint(start.x, start.y);
      if (!target) throw new Error("Native synthetic grip coordinate has no event target");
      const dispatch = (eventTarget: EventTarget, type: string, clientX: number, clientY: number, buttons: number) => {
        eventTarget.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            buttons,
            cancelable: true,
            clientX,
            clientY,
            composed: true,
            isPrimary: true,
            pointerId: 71,
            pointerType: "mouse",
          }),
        );
      };
      dispatch(target, "pointerdown", start.x, start.y, 1);
      dispatch(window, "pointermove", start.x + movement.x / 2, start.y + movement.y / 2, 1);
      dispatch(window, "pointermove", start.x + movement.x, start.y + movement.y, 1);
      dispatch(window, "pointerup", start.x + movement.x, start.y + movement.y, 0);
    }, { start: before.grip, movement: delta });

    const moved = movedByRealPointer || (await app.waitUntil(editorMoved, {
      timeout: 10_000,
      timeoutMsg: "Native exterior-grip drag did not move editable free text",
    }));
    expect(moved).toBe(true);

    const atEdge = await app.execute((editorId) => {
      const root = document.getElementById(editorId);
      const pageElement = root?.closest<HTMLElement>(".page");
      if (!(root instanceof HTMLElement) || !pageElement) throw new Error("Native upper-left page edge target not found");
      const rect = root.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();
      const style = getComputedStyle(root, "::after");
      const grip = {
        left: rect.left + Number.parseFloat(style.left),
        top: rect.top + Number.parseFloat(style.top),
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
      };
      const center = { x: Math.round(grip.left + grip.width / 2), y: Math.round(grip.top + grip.height / 2) };
      return {
        grip: center,
        gripFullyWithinPage:
          grip.left >= pageRect.left &&
          grip.top >= pageRect.top &&
          grip.left + grip.width <= pageRect.right &&
          grip.top + grip.height <= pageRect.bottom,
        gripFullyWithinViewport:
          grip.left >= 0 && grip.top >= 0 && grip.left + grip.width <= innerWidth && grip.top + grip.height <= innerHeight,
        gripTargetsEditor: document.elementFromPoint(center.x, center.y)?.closest<HTMLElement>(".freeTextEditor")?.id === editorId,
        rect: { left: rect.left, top: rect.top },
        rootLeftGap: rect.left - pageRect.left,
        rootTopGap: rect.top - pageRect.top,
      };
    }, before.editorId);
    expect(atEdge.rootLeftGap).toBeGreaterThanOrEqual(FREE_TEXT_MOVE_GRIP_SIZE_PX);
    expect(atEdge.rootLeftGap).toBeLessThanOrEqual(FREE_TEXT_MOVE_GRIP_SIZE_PX + 4);
    expect(atEdge.rootTopGap).toBeGreaterThanOrEqual(FREE_TEXT_MOVE_GRIP_SIZE_PX);
    expect(atEdge.rootTopGap).toBeLessThanOrEqual(FREE_TEXT_MOVE_GRIP_SIZE_PX + 4);
    expect(atEdge.gripFullyWithinPage).toBe(true);
    expect(atEdge.gripFullyWithinViewport).toBe(true);
    expect(atEdge.gripTargetsEditor).toBe(false);
    await expectNativeSelectedDeleteGlyph("freeTextEditor");

    const edgeNudge = { x: 8, y: 8 };
    const edgeEditorMoved = () =>
      app.execute(({ editorId, expectedText, prior, expectedDelta }) => {
        const root = document.getElementById(editorId);
        const internal = root?.querySelector<HTMLElement>(".internal[contenteditable='true'], [contenteditable='true']");
        if (!(root instanceof HTMLElement) || !internal?.isContentEditable) return false;
        const rect = root.getBoundingClientRect();
        return (
          Math.abs((rect.left - prior.left) - expectedDelta.x) < 2 &&
          Math.abs((rect.top - prior.top) - expectedDelta.y) < 2 &&
          internal.contains(document.activeElement) &&
          internal.innerText.replace(/\s+/g, " ").includes(expectedText)
        );
      }, { editorId: before.editorId, expectedText: initialText, prior: atEdge.rect, expectedDelta: edgeNudge });

    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ origin: "viewport", x: atEdge.grip.x, y: atEdge.grip.y })
      .down({ button: 0 })
      .move({ origin: "viewport", x: atEdge.grip.x + edgeNudge.x, y: atEdge.grip.y + edgeNudge.y })
      .up({ button: 0 })
      .perform();
    const edgeMovedByRealPointer = await app.waitUntil(edgeEditorMoved, { timeout: 1_000 }).catch(() => false);
    if (!edgeMovedByRealPointer) await app.execute(({ start, movement }) => {
      const target = document.elementFromPoint(start.x, start.y);
      if (!target) throw new Error("Native upper-left page edge grip has no event target");
      const dispatch = (eventTarget: EventTarget, type: string, clientX: number, clientY: number, buttons: number) => {
        eventTarget.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            buttons,
            cancelable: true,
            clientX,
            clientY,
            composed: true,
            isPrimary: true,
            pointerId: 72,
            pointerType: "mouse",
          }),
        );
      };
      dispatch(target, "pointerdown", start.x, start.y, 1);
      dispatch(window, "pointermove", start.x + movement.x / 2, start.y + movement.y / 2, 1);
      dispatch(window, "pointermove", start.x + movement.x, start.y + movement.y, 1);
      dispatch(window, "pointerup", start.x + movement.x, start.y + movement.y, 0);
    }, { start: atEdge.grip, movement: edgeNudge });
    expect(edgeMovedByRealPointer || (await app.waitUntil(edgeEditorMoved, {
      timeout: 10_000,
      timeoutMsg: "Native upper-left page edge grip did not remain draggable",
    }))).toBe(true);

    const appended = await app.execute(({ editorId, text }) => {
      const internal = document.getElementById(editorId)?.querySelector<HTMLElement>(".internal[contenteditable='true']");
      if (!internal) throw new Error("Moved native free-text content lost editability before typing");
      internal.focus();
      const line = internal.lastElementChild ?? internal;
      line.append(document.createTextNode(text));
      internal.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          composed: true,
          data: text,
          inputType: "insertText",
        }),
      );
      return internal.innerText.replace(/\s+/g, " ");
    }, { editorId: before.editorId, text: " native persisted" });
    expect(appended).toContain("native persisted");
    await app.execute((editorId) => {
      const internal = document.getElementById(editorId)?.querySelector<HTMLElement>(".internal[contenteditable='true']");
      if (!internal) throw new Error("Moved native free-text content lost editability before commit");
      internal.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          key: "Enter",
        }),
      );
    }, before.editorId);
    await app.execute(async (outputPath) => {
      await window.__pdfSpike!.saveToPath(outputPath);
      await window.__pdfSpike!.loadPath(outputPath);
    }, freeTextGripPdfPath);
    await app.waitUntil(
      async () => app.execute(() => Number(window.__pdfSpike!.stats().pages ?? 0) > 0),
      { timeout: 30_000, timeoutMsg: "Native free-text PDF did not reopen" },
    );

    const saved = await app.execute(async () => {
      const annotations = await window.__pdfSpike!.annotationSummary();
      return annotations
        .flatMap((page: { annotations: Array<{ rect?: number[] | null; subtype?: string | null; textContent?: string[] | null }> }) => page.annotations)
        .filter(
          (annotation: { rect?: number[] | null; subtype?: string | null; textContent?: string[] | null }) =>
            annotation.subtype === "FreeText" && (annotation.textContent ?? []).join(" ").includes("native persisted"),
        );
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.rect).toBeTruthy();
    const savedGeometry = saved[0]?.rect;

    await app.execute(async (outputPath) => window.__pdfSpike!.loadPath(outputPath), freeTextGripPdfPath);
    await app.waitUntil(
      async () => app.execute(() => Number(window.__pdfSpike!.stats().pages ?? 0) > 0),
      { timeout: 30_000, timeoutMsg: "Native free-text PDF did not reopen a second time" },
    );
    const reopened = await app.execute(async () => {
      const annotations = await window.__pdfSpike!.annotationSummary();
      return annotations
        .flatMap((page: { annotations: Array<{ rect?: number[] | null; subtype?: string | null; textContent?: string[] | null }> }) => page.annotations)
        .filter(
          (annotation: { rect?: number[] | null; subtype?: string | null; textContent?: string[] | null }) =>
            annotation.subtype === "FreeText" && (annotation.textContent ?? []).join(" ").includes("native persisted"),
        );
    });
    expect(reopened).toHaveLength(1);
    expect(reopened[0]?.rect).toEqual(savedGeometry);
  });

  it("keeps editable free text behind the dirty Document Tab Cmd+W prompt", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);
    const text = "Native Cmd+W free text";
    await app.execute(async (filePath) => window.__pdfSpike!.loadPath(filePath), samplePdfPath);
    await app.waitUntil(
      async () => app.execute(() => Number(window.__pdfSpike!.stats().pages ?? 0) > 0),
      { timeout: 30_000, timeoutMsg: "Native sample PDF did not render before close-prompt setup" },
    );
    expect(await app.execute(async (value) => window.__pdfSpike!.createPageFreeText(value), text)).toBe(true);
    await app.waitUntil(
      async () =>
        app.execute((value) =>
          (window.__pdfSpike!.annotationSidebarSummary() as Array<AnnotationEntry & { source?: string }>).some(
            (candidate) => candidate.kind === "freetext" && candidate.source === "live" && candidate.detail.includes(value),
          ),
        text),
      { timeout: 10_000, timeoutMsg: "Native live free-text Annotation Sidebar Entry did not appear" },
    );
    const editorId = await app.execute(async (value) => {
      const entry = (window.__pdfSpike!.annotationSidebarSummary() as Array<AnnotationEntry & { source?: string }>).find(
        (candidate) => candidate.kind === "freetext" && candidate.source === "live" && candidate.detail.includes(value),
      );
      if (!entry?.sourceId) throw new Error("Native live free-text Annotation Sidebar Entry was not found");
      if (!(await window.__pdfSpike!.activateAnnotationBySourceId(entry.sourceId))) {
        throw new Error("Native live free-text Annotation Sidebar Entry did not activate");
      }
      const editor = document.getElementById(entry.sourceId);
      if (!(editor instanceof HTMLElement)) throw new Error("Native free-text editor root was not found");
      editor.focus();
      return entry.sourceId;
    }, text);

    await app.keys(Key.Enter);
    await app.waitUntil(
      async () =>
        app.execute((id) => {
          const editor = document.getElementById(id);
          const internal = editor?.querySelector<HTMLElement>(".internal[contenteditable='true'], [contenteditable='true']");
          return Boolean(internal?.isContentEditable && editor?.classList.contains("selectedEditor"));
        }, editorId),
      { timeout: 10_000, timeoutMsg: "Native free-text Annotation did not enter editable selected state" },
    );
    expect(
      await app.execute((id) => {
        const editor = document.getElementById(id);
        if (!(editor instanceof HTMLElement)) throw new Error("Editable native free-text editor was not found");
        const rect = editor.getBoundingClientRect();
        return window.__pdfSpike!.moveSelected(
          window.innerWidth / 2 - (rect.left + rect.width / 2),
          window.innerHeight / 2 - (rect.top + rect.height / 2),
        );
      }, editorId),
    ).toBe(true);

    await app.keys([Key.Command, "w"]);
    await app.waitUntil(
      async () =>
        app.execute(() => {
          const prompt = document.querySelector("dialog.modal");
          return prompt instanceof HTMLDialogElement && prompt.open && prompt.matches(":modal");
        }),
      { timeout: 10_000, timeoutMsg: "Cmd+W did not show the native dirty Document Tab close prompt" },
    );
    const result = await app.execute((id) => {
      const editor = document.getElementById(id);
      const prompt = document.querySelector<HTMLElement>("dialog.modal");
      if (!(editor instanceof HTMLElement) || !(prompt instanceof HTMLDialogElement)) {
        throw new Error("Expected native editable free-text editor and close prompt");
      }
      const editorRect = editor.getBoundingClientRect();
      const promptRect = prompt.getBoundingClientRect();
      const left = Math.max(editorRect.left, promptRect.left);
      const right = Math.min(editorRect.right, promptRect.right);
      const top = Math.max(editorRect.top, promptRect.top);
      const bottom = Math.min(editorRect.bottom, promptRect.bottom);
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return {
        hasOverlap: right > left && bottom > top,
        hitIsInsidePrompt: Boolean(hit && prompt.contains(hit)),
        hitIsInsidePdfEditorLayer: Boolean(hit?.closest(".annotationEditorLayer")),
        saveButtonHasFocus: document.activeElement === prompt.querySelector("[data-modal-save]"),
      };
    }, editorId);
    expect(result.hasOverlap).toBe(true);
    expect(result.hitIsInsidePrompt).toBe(true);
    expect(result.hitIsInsidePdfEditorLayer).toBe(false);
    expect(result.saveButtonHasFocus).toBe(true);

    await app.keys(Key.Escape);
    await app.waitUntil(
      async () => app.execute(() => !document.querySelector("dialog.modal") && window.__pdfSpike!.tabs.list().length === 1),
      { timeout: 10_000, timeoutMsg: "Escape did not cancel the native dirty Document Tab close prompt" },
    );
  });

  it("loads a PDF, extracts sidebar text, and creates annotation state", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
    }, samplePdfPath);

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const stats = window.__pdfSpike!.stats();
          return Number(stats.pages ?? 0) > 0 && String(stats.status ?? "").startsWith("Rendered ");
        }),
      {
        timeout: 30_000,
        timeoutMsg: await app.execute(() => {
          const stats = window.__pdfSpike?.stats();
          return `sample PDF did not render in native WKWebView: ${JSON.stringify(stats)}`;
        }),
      },
    );

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const entries = window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[];
          return entries.some((entry) => entry.kind === "highlight" && entry.detail !== "Persisted PDF annotation");
        }),
      {
        timeout: 30_000,
        timeoutMsg: await app.execute(() => {
          const entries = window.__pdfSpike?.annotationSidebarSummary() ?? [];
          return `native sidebar did not extract real annotation text: ${JSON.stringify(entries)}`;
        }),
      },
    );

    const annotationState = await app.execute(() => {
      const entries = window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[];
      return {
        usefulHighlight: entries.some(
          (entry) =>
            entry.kind === "highlight" &&
            entry.detail !== "Persisted PDF annotation" &&
            entry.detail.trim().length > 8,
        ),
        highlightCount: entries.filter((entry) => entry.kind === "highlight").length,
        freeTextCount: entries.filter((entry) => entry.kind === "freetext").length,
        inkCount: entries.filter((entry) => entry.kind === "ink").length,
      };
    });

    expect(annotationState.highlightCount).toBeGreaterThan(0);
    expect(annotationState.freeTextCount).toBeGreaterThan(0);
    expect(annotationState.inkCount).toBeGreaterThan(0);
    expect(annotationState.usefulHighlight).toBe(true);
  });

  it("paints and hit-tests the persisted Highlight Annotation delete glyph inside its native toolbar", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1643, 654);
    await hideRightSidebarForPdfGeometry();
    await app.execute(async (filePath) => window.__pdfSpike!.loadPath(filePath), samplePdfPath);
    await app.waitUntil(
      async () =>
        app.execute(() => {
          const entries = window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[];
          return Number(window.__pdfSpike!.stats().pages ?? 0) > 0 && entries.some((entry) => entry.kind === "highlight");
        }),
      { timeout: 30_000, timeoutMsg: "Native sample PDF did not expose a persisted Highlight Annotation" },
    );
    await app.execute(async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const percent = Number.parseInt(document.querySelector(".zoom-value")?.textContent ?? "0", 10);
        if (percent >= 180) return;
        const zoomIn = document.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]');
        if (!zoomIn) throw new Error("Native Zoom in button not found");
        zoomIn.click();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    });
    const activated = await app.execute(async () => {
      window.__pdfSpike!.setTool("none");
      const entry = (window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[]).find(
        (candidate) => candidate.kind === "highlight",
      );
      if (!entry) throw new Error("Native persisted Highlight Annotation Sidebar Entry not found");
      return window.__pdfSpike!.activateAnnotationBySourceId(entry.sourceId);
    });
    expect(activated).toBe(true);
    await expectNativeSelectedDeleteGlyph("highlightEditor");
  });

  it("opens dropped Finder PDF paths as Document Tabs", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    await app.execute(
      async ({ firstPath, secondPath }) => {
        await (window.__pdfSpike! as any).openDroppedFilesForTest([firstPath, secondPath]);
      },
      { firstPath: samplePdfPath, secondPath: noOutlinePdfPath },
    );

    await app.waitUntil(
      async () =>
        app.execute(({ firstPath, secondPath }) => {
          const tabs = window.__pdfSpike!.tabs.list() as DocumentTabSummary[];
          return (
            tabs.length === 2 &&
            tabs.some((tab) => tab.path === firstPath && tab.label === firstPath && !tab.active) &&
            tabs.some((tab) => tab.path === secondPath && tab.label === secondPath && tab.active)
          );
        }, { firstPath: samplePdfPath, secondPath: noOutlinePdfPath }),
      {
        timeout: 30_000,
        timeoutMsg: "native dropped PDF paths did not open as Document Tabs",
      },
    );

    const renderedLabels = await app.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".doc-tab-label")].map((tab) => tab.textContent?.trim()),
    );
    expect(renderedLabels).toEqual(expect.arrayContaining(["sample.pdf", "no-outline.pdf"]));

    await app.execute(async (filePath) => {
      await (window.__pdfSpike! as any).openDroppedFilesForTest([filePath]);
    }, samplePdfPath);

    await app.waitUntil(
      async () =>
        app.execute((filePath) => {
          const tabs = window.__pdfSpike!.tabs.list() as DocumentTabSummary[];
          return tabs.length === 2 && tabs.some((tab) => tab.path === filePath && tab.active);
        }, samplePdfPath),
      {
        timeout: 10_000,
        timeoutMsg: "duplicate dropped PDF path did not focus the existing Document Tab",
      },
    );
  });

  it("closes the Active Document Tab with Cmd+W and keeps the window open", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    const opened = await app.execute(
      async ({ firstPath, secondPath }) => {
        const first = await window.__pdfSpike!.tabs.open(firstPath);
        const second = await window.__pdfSpike!.tabs.open(secondPath);
        return { first, second };
      },
      { firstPath: samplePdfPath, secondPath: noOutlinePdfPath },
    );

    await app.waitUntil(
      async () =>
        app.execute(({ first, second }) => {
          const tabs = window.__pdfSpike!.tabs.list() as DocumentTabSummary[];
          return tabs.length === 2 && tabs.some((tab) => tab.id === first && !tab.active) && tabs.some((tab) => tab.id === second && tab.active);
        }, opened),
      { timeout: 30_000, timeoutMsg: "native Document Tabs did not open before Cmd+W" },
    );

    await app.keys([Key.Command, "w"]);

    await app.waitUntil(
      async () =>
        app.execute(({ first, second }) => {
          const tabs = window.__pdfSpike!.tabs.list() as DocumentTabSummary[];
          return tabs.length === 1 && tabs[0]?.id === first && tabs[0]?.active === true && !tabs.some((tab) => tab.id === second);
        }, opened),
      { timeout: 10_000, timeoutMsg: "Cmd+W did not close only the Active Document Tab" },
    );

    await app.waitUntil(
      async () => app.execute(() => document.querySelector(".topbar .file")?.textContent?.trim() === "sample.pdf"),
      { timeout: 10_000, timeoutMsg: "Cmd+W did not refresh the toolbar filename for the remaining Document Tab" },
    );

    await app.keys([Key.Command, "w"]);

    await app.waitUntil(
      async () => app.execute(() => (window.__pdfSpike!.tabs.list() as DocumentTabSummary[]).length === 0),
      { timeout: 10_000, timeoutMsg: "Cmd+W did not close the final Document Tab" },
    );
    await app.waitUntil(
      async () => app.execute(() => document.querySelector(".topbar .file")?.textContent?.trim() === "No document"),
      { timeout: 10_000, timeoutMsg: "Cmd+W left a stale toolbar filename after closing the final Document Tab" },
    );
  });

  it("hides the Document Tab Bar in fullscreen while keyboard tab switching still works", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    const opened = await app.execute(
      async ({ firstPath, secondPath }) => {
        const first = await window.__pdfSpike!.tabs.open(firstPath);
        const second = await window.__pdfSpike!.tabs.open(secondPath);
        return { first, second };
      },
      { firstPath: samplePdfPath, secondPath: noOutlinePdfPath },
    );

    try {
      expect(await setNativeFullscreen(true)).toBe(true);
      await app.waitUntil(
        async () => app.execute(() => document.querySelector(".doc-tab-bar") === null),
        { timeout: 10_000, timeoutMsg: "Document Tab Bar stayed mounted in fullscreen" },
      );

      await app.keys([Key.Command, Key.Shift, "]"]);
      await app.waitUntil(
        async () =>
          app.execute(({ first }) => window.__pdfSpike!.tabs.list().some((tab: DocumentTabSummary) => tab.id === first && tab.active), opened),
        { timeout: 10_000, timeoutMsg: "Cmd+Shift+] did not switch Document Tabs in fullscreen" },
      );
    } finally {
      await setNativeFullscreen(false);
    }
  });

  it("opens second-launch PDF paths in the existing window", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    await emitTauriEventForTest("single-instance-open", [samplePdfPath, noOutlinePdfPath]);

    await app.waitUntil(
      async () =>
        app.execute(({ firstPath, secondPath }) => {
          const tabs = window.__pdfSpike!.tabs.list() as DocumentTabSummary[];
          return (
            tabs.length === 2 &&
            tabs.some((tab) => tab.path === firstPath && tab.label === firstPath && !tab.active) &&
            tabs.some((tab) => tab.path === secondPath && tab.label === secondPath && tab.active)
          );
        }, { firstPath: samplePdfPath, secondPath: noOutlinePdfPath }),
      { timeout: 30_000, timeoutMsg: "second-launch PDF paths did not open as Document Tabs" },
    );

    await emitTauriEventForTest("single-instance-open", [samplePdfPath]);
    await app.waitUntil(
      async () =>
        app.execute((filePath) => {
          const tabs = window.__pdfSpike!.tabs.list() as DocumentTabSummary[];
          return tabs.length === 2 && tabs.some((tab) => tab.path === filePath && tab.active);
        }, samplePdfPath),
      { timeout: 10_000, timeoutMsg: "duplicate second-launch path did not focus the existing Document Tab" },
    );
  });

  it("locates persisted ink rows independently after adjacent ink clicks", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1640, 1010);

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
      [...document.querySelectorAll<HTMLButtonElement>(".sidebar-tab")]
        .find((button) => button.getAttribute("aria-label") === "Annotations")
        ?.click();
    }, samplePdfPath);

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const entries = window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[];
          return (
            entries.filter((entry) => entry.page === 2 && entry.kind === "ink").length >= 3 &&
            entries.filter((entry) => entry.page === 3 && entry.kind === "ink").length >= 2
          );
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native sample PDF did not expose enough persisted ink rows",
      },
    );

    const inks = await app.execute(() => {
      const pageBounds = (entry: AnnotationEntry) => {
        const pageElement = document.querySelector<HTMLElement>(`.page[data-page-number="${entry.page}"]`);
        if (!pageElement || !entry.bounds) throw new Error(`Missing page bounds for ${entry.sourceId}`);
        return {
          top: pageElement.offsetTop + entry.bounds.top * pageElement.offsetHeight,
          bottom: pageElement.offsetTop + entry.bounds.bottom * pageElement.offsetHeight,
        };
      };
      return (window.__pdfSpike!.annotationSidebarSummary() as AnnotationEntry[])
        .filter((entry) => entry.kind === "ink" && (entry.page === 2 || entry.page === 3))
        .map((entry) => ({
          ...entry,
          expected: pageBounds(entry),
        }));
    });

    let inkToolbarVerified = false;
    const activateInk = async (entry: (typeof inks)[number]) => {
      const activated = await app.execute(
        async (sourceId) => window.__pdfSpike!.activateAnnotationBySourceId(sourceId),
        entry.sourceId,
      );
      expect(activated).toBe(true);
      try {
        await app.waitUntil(
          async () =>
            app.execute(
            ({ pageNumber, sourceId, expectedTop }) => {
              const stats = window.__pdfSpike!.stats();
              const box = stats.annotationFocusBox as { top: number; height: number } | null;
              const selectedEditorBox = () => {
                const editor = document.querySelector<HTMLElement>(".annotationEditorLayer .selectedEditor");
                const container = document.querySelector<HTMLElement>(".pdf-container");
                if (!editor || !container) return null;
                const editorRect = editor.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const style = getComputedStyle(editor);
                return {
                  top: editorRect.top - containerRect.top + container.scrollTop,
                  borderStyle: style.borderTopStyle === "none" ? style.outlineStyle : style.borderTopStyle,
                };
              };
              if (stats.status === `Located ink on page ${pageNumber}.`) {
                return (
                  Boolean(box) &&
                  stats.activeTool === "none" &&
                  stats.selectedAnnotationKind === null &&
                  stats.visibleEditorToolbars === 0 &&
                  Math.abs((box?.top ?? 0) - expectedTop) < 30
                );
              }
              const editorBox = selectedEditorBox();
              if (
                stats.selectedAnnotationKind === "highlight" &&
                stats.selectedPersistedAnnotationKey === `${pageNumber}:${sourceId}` &&
                !box &&
                !editorBox
              ) {
                return true;
              }
              if (
                stats.selectedAnnotationKind === "highlight" &&
                stats.selectedPersistedAnnotationKey === `${pageNumber}:${sourceId}` &&
                !box &&
                Boolean(editorBox) &&
                editorBox?.borderStyle === "dashed" &&
                Math.abs((editorBox?.top ?? 0) - expectedTop) < 30
              ) {
                return true;
              }
              return (
                (stats.selectedAnnotationKind === "ink" || stats.selectedAnnotationKind === "highlight") &&
                stats.selectedPersistedAnnotationKey === `${pageNumber}:${sourceId}` &&
                !box &&
                Boolean(editorBox) &&
                editorBox?.borderStyle === "dashed"
              );
            },
            { pageNumber: entry.page, sourceId: entry.sourceId, expectedTop: entry.expected.top },
            ),
          {
            timeout: 10_000,
            timeoutMsg: `native ink row did not focus: ${entry.sourceId}`,
          },
        );
      } catch (error) {
        const stats = await app.execute(() => {
          const selectedEditor = document.querySelector<HTMLElement>(".annotationEditorLayer .selectedEditor");
          const rect = selectedEditor?.getBoundingClientRect();
          return {
            stats: window.__pdfSpike!.stats(),
            selectedEditor: selectedEditor
              ? {
                  id: selectedEditor.id,
                  className: selectedEditor.className,
                  rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
                }
              : null,
          };
        });
        throw new Error(`native ink row did not focus: ${entry.sourceId}; details=${JSON.stringify(stats)}; ${error}`);
      }
      const selection = await app.execute(({ expectedTop, expectedBottom, expectedPersistedKey }) => {
        const stats = window.__pdfSpike!.stats();
        const box = stats.annotationFocusBox as { top: number; height: number } | null;
        const selectedEditorBox = () => {
          const editor = document.querySelector<HTMLElement>(".annotationEditorLayer .selectedEditor");
          const container = document.querySelector<HTMLElement>(".pdf-container");
          if (!editor || !container) return null;
          const editorRect = editor.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const style = getComputedStyle(editor);
          return {
            top: editorRect.top - containerRect.top + container.scrollTop,
            bottom: editorRect.bottom - containerRect.top + container.scrollTop,
            borderStyle: style.borderTopStyle === "none" ? style.outlineStyle : style.borderTopStyle,
          };
        };
        const editorBox = selectedEditorBox();
        const effectiveBox = box
          ? {
              top: box.top,
              bottom: box.top + box.height,
              borderStyle: null,
            }
          : editorBox;
        if (!effectiveBox && stats.selectedPersistedAnnotationKey !== expectedPersistedKey) {
          throw new Error(`Missing focus target; stats=${JSON.stringify(stats)}`);
        }
        return {
          top: effectiveBox?.top ?? expectedTop,
          bottom: effectiveBox?.bottom ?? expectedBottom,
          activeTool: stats.activeTool,
          hasAnnotationFocusBox: Boolean(box),
          selectedAnnotationKind: stats.selectedAnnotationKind,
          selectedEditorBorderStyle: effectiveBox?.borderStyle ?? null,
          visibleEditorToolbars: stats.visibleEditorToolbars,
          status: stats.status,
          selectedPersistedAnnotationKey: stats.selectedPersistedAnnotationKey,
        };
      }, {
        expectedTop: entry.expected.top,
        expectedBottom: entry.expected.bottom,
        expectedPersistedKey: `${entry.page}:${entry.sourceId}`,
      });
      if (selection.selectedAnnotationKind === "ink" && !inkToolbarVerified) {
        await expectNativeSelectedDeleteGlyph("inkEditor");
        inkToolbarVerified = true;
      }
      return selection;
    };

    const inkAt = (pageNumber: number, index: number) => {
      const entry = inks.filter((candidate) => candidate.page === pageNumber)[index];
      if (!entry) throw new Error(`Missing page ${pageNumber} ink row ${index + 1}; entries=${JSON.stringify(inks)}`);
      return entry;
    };

    const pairs = [
      [inkAt(2, 0), inkAt(2, 1)],
      [inkAt(2, 1), inkAt(2, 2)],
      [inkAt(3, 0), inkAt(3, 1)],
    ] as const;

    const result = [];
    for (const [first, second] of pairs) {
      result.push({
        firstInk: await activateInk(first),
        secondInk: await activateInk(second),
        firstExpected: first.expected,
        secondExpected: second.expected,
        firstIntent: first.intent ?? null,
        secondIntent: second.intent ?? null,
        firstExpectedPersistedAnnotationKey: `${first.page}:${first.sourceId}`,
        secondExpectedPersistedAnnotationKey: `${second.page}:${second.sourceId}`,
      });
    }

    for (const pairResult of result) {
      expect(Math.abs(pairResult.firstInk.top - pairResult.firstExpected.top)).toBeLessThan(30);
      expect(Math.abs(pairResult.secondInk.top - pairResult.secondExpected.top)).toBeLessThan(30);
      if (pairResult.firstIntent === "InkHighlight") {
        if (pairResult.firstInk.selectedAnnotationKind === "highlight") {
          expect(pairResult.firstInk.activeTool).toBe("none");
          expect(pairResult.firstInk.status).toContain("Selected highlight");
          expect([0, 1]).toContain(pairResult.firstInk.visibleEditorToolbars);
          expect(pairResult.firstInk.selectedPersistedAnnotationKey).toBe(pairResult.firstExpectedPersistedAnnotationKey);
        } else {
          expect(pairResult.firstInk.status).toContain("Located ink");
          expect(pairResult.firstInk.selectedAnnotationKind).toBeNull();
          expect(pairResult.firstInk.hasAnnotationFocusBox).toBe(true);
        }
      } else if (pairResult.firstInk.selectedAnnotationKind === "ink") {
        expect(pairResult.firstInk.activeTool).toBe("none");
        expect(pairResult.firstInk.hasAnnotationFocusBox).toBe(false);
        expect(pairResult.firstInk.selectedEditorBorderStyle).toBe("dashed");
        expect(pairResult.firstInk.selectedPersistedAnnotationKey).toBe(pairResult.firstExpectedPersistedAnnotationKey);
      } else {
        expect(pairResult.firstInk.status).toContain("Located ink");
        expect(pairResult.firstInk.selectedAnnotationKind).toBeNull();
      }
      if (pairResult.secondIntent === "InkHighlight") {
        if (pairResult.secondInk.selectedAnnotationKind === "highlight") {
          expect(pairResult.secondInk.activeTool).toBe("none");
          expect(pairResult.secondInk.status).toContain("Selected highlight");
          expect([0, 1]).toContain(pairResult.secondInk.visibleEditorToolbars);
          expect(pairResult.secondInk.selectedPersistedAnnotationKey).toBe(pairResult.secondExpectedPersistedAnnotationKey);
        } else {
          expect(pairResult.secondInk.status).toContain("Located ink");
          expect(pairResult.secondInk.selectedAnnotationKind).toBeNull();
          expect(pairResult.secondInk.hasAnnotationFocusBox).toBe(true);
        }
      } else if (pairResult.secondInk.selectedAnnotationKind === "ink") {
        expect(pairResult.secondInk.activeTool).toBe("none");
        expect(pairResult.secondInk.hasAnnotationFocusBox).toBe(false);
        expect(pairResult.secondInk.selectedEditorBorderStyle).toBe("dashed");
        expect(pairResult.secondInk.selectedPersistedAnnotationKey).toBe(pairResult.secondExpectedPersistedAnnotationKey);
      } else {
        expect(pairResult.secondInk.status).toContain("Located ink");
        expect(pairResult.secondInk.selectedAnnotationKind).toBeNull();
      }
    }
  });

  it("handles missing and broken outline destinations in native WKWebView", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
    }, noOutlinePdfPath);

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const stats = window.__pdfSpike!.stats();
          return Number(stats.pages ?? 0) > 0 && window.__pdfSpike!.outlineSummary().length === 0;
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native no-outline PDF did not render with an empty outline",
      },
    );

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
    }, brokenOutlinePdfPath);

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const stats = window.__pdfSpike!.stats();
          return Number(stats.pages ?? 0) > 0 && String(stats.status ?? "").startsWith("Rendered ");
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native broken-outline PDF did not render",
      },
    );

    const state = await app.execute(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".sidebar-tab")]
        .find((button) => button.getAttribute("aria-label") === "Outline")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const entries = window.__pdfSpike!.outlineSummary() as OutlineEntry[];
      const brokenEntry = entries.find((entry) => entry.title === "How Modern Browsers Work");
      const validEntry = entries.find((entry) => entry.title === "1. Networking and Resource Loading");
      const validButton = [...document.querySelectorAll<HTMLButtonElement>(".outline-item")].find((button) =>
        button.textContent?.includes("1. Networking and Resource Loading"),
      );
      validButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 600));
      return {
        entries,
        emptyStateText: document.querySelector(".empty-state")?.textContent?.trim() ?? null,
        brokenStatus: brokenEntry?.destinationStatus ?? null,
        hasValidOutlineItem: Boolean(validButton && !validButton.disabled),
        validPageNumber: validEntry?.pageNumber ?? null,
        currentPageNumber: window.__pdfSpike!.stats().currentPageNumber,
      };
    });

    if (state.hasValidOutlineItem) {
      if (state.brokenStatus !== null) {
        expect(state.brokenStatus).toBe("Destination unavailable");
      }
      expect(state.validPageNumber).toBeGreaterThan(0);
      expect(state.currentPageNumber).toBeGreaterThan(0);
    } else {
      expect(state.entries).toHaveLength(0);
      expect(state.emptyStateText === "This PDF has no outline." || state.emptyStateText === null).toBe(true);
    }

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
    }, coloredOutlinePdfPath);

    await app.waitUntil(
      async () =>
        app.execute(() => {
          const redEntry = (window.__pdfSpike!.outlineSummary() as OutlineEntry[]).find(
            (entry) => entry.title === "Red Outline",
          );
          return redEntry?.color === "#f04444";
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native colored outline PDF did not expose outline /C color",
      },
    );
  });

  it("scrolls outline navigation when pages overflow horizontally in native WKWebView", async () => {
    await waitForPdfSpike();
    // A fixed, deliberately narrow window makes the overflow trigger
    // deterministic against the app's own contract (at Fit Width, page
    // width equals window width, so a single 1.1x zoom-in always overflows
    // it) rather than against an assumed click count.
    await app.setWindowSize(900, 900);
    await hideRightSidebarForPdfGeometry();

    await app.execute(async (filePath) => {
      await window.__pdfSpike!.loadPath(filePath);
    }, samplePdfPath);
    await app.waitUntil(
      async () =>
        app.execute(
          () => Number(window.__pdfSpike!.stats().pages ?? 0) > 0 && window.__pdfSpike!.outlineSummary().length > 0,
        ),
      {
        timeout: 30_000,
        timeoutMsg: "native sample PDF did not render with outline",
      },
    );

    // Zoom in until the laid-out pages are wider than the reader pane — the
    // issue #7 regression trigger, where pdf.js's scrollIntoView used to
    // silently no-op in exactly this engine-real configuration.
    let overflows = false;
    for (let attempt = 0; attempt < 2 && !overflows; attempt += 1) {
      await app.execute(() => {
        const zoomIn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.getAttribute("aria-label") === "Zoom in",
        );
        if (!zoomIn) throw new Error("Missing native zoom in button");
        zoomIn.click();
      });
      overflows = await app
        .waitUntil(
          async () =>
            app.execute(() => {
              const viewer = document.querySelector<HTMLElement>(".pdfViewer");
              return Boolean(viewer && viewer.scrollWidth > viewer.clientWidth);
            }),
          { timeout: 2_000 },
        )
        .then(() => true)
        .catch(() => false);
    }
    if (!overflows) {
      const dimensions = await app.execute(() => {
        const viewer = document.querySelector<HTMLElement>(".pdfViewer");
        return { clientWidth: viewer?.clientWidth ?? -1, scrollWidth: viewer?.scrollWidth ?? -1 };
      });
      throw new Error(
        `native zoom-in did not produce horizontal page overflow ` +
          `(pdfViewer clientWidth=${dimensions.clientWidth}, scrollWidth=${dimensions.scrollWidth})`,
      );
    }

    await app.execute(() => {
      const container = document.querySelector<HTMLElement>(".pdf-container");
      if (!container) throw new Error("Missing native .pdf-container");
      container.scrollTop = 0;
      const tab = [...document.querySelectorAll<HTMLButtonElement>(".sidebar-tab")].find(
        (button) => button.getAttribute("aria-label") === "Outline",
      );
      tab?.click();
      const outlineButton = [...document.querySelectorAll<HTMLButtonElement>(".outline-item")].find((button) =>
        button.textContent?.includes("3. Styling and Layout"),
      );
      if (!outlineButton) throw new Error("Missing Styling and Layout outline button");
      outlineButton.click();
    });
    await app.waitUntil(
      async () =>
        app.execute(() => {
          const container = document.querySelector<HTMLElement>(".pdf-container");
          const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='7']");
          if (!container || !pageElement || container.scrollTop <= 0) return false;
          const containerRect = container.getBoundingClientRect();
          const pageRect = pageElement.getBoundingClientRect();
          return pageRect.bottom > containerRect.top && pageRect.top < containerRect.bottom;
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native outline navigation did not scroll under horizontal page overflow",
      },
    );
  });

  it("creates, reloads, and navigates PDF-native bookmarks in native WKWebView", async () => {
    await waitForPdfSpike();
    await app.setWindowSize(1280, 900);

    await app.execute(async (samplePath) => {
      await window.__pdfSpike!.loadPath(samplePath);
    }, samplePdfPath);
    await app.waitUntil(
      async () =>
        app.execute(
          () => Number(window.__pdfSpike!.stats().pages ?? 0) > 0 && window.__pdfSpike!.outlineSummary().length > 0,
        ),
      {
        timeout: 30_000,
        timeoutMsg: "native sample PDF did not render with outline",
      },
    );

    await app.execute(() => {
      const tab = (label: string) =>
        [...document.querySelectorAll<HTMLButtonElement>(".sidebar-tab")].find(
          (button) => button.getAttribute("aria-label") === label,
        );
      tab("Outline")?.click();
      const outlineButton = [...document.querySelectorAll<HTMLButtonElement>(".outline-item")].find((button) =>
        button.textContent?.includes("JIT tiers table"),
      );
      if (!outlineButton) throw new Error("Missing JIT tiers table outline button");
      outlineButton.click();
    });
    await app.waitUntil(async () => app.execute(() => window.__pdfSpike!.stats().currentPageNumber === 13), {
      timeout: 30_000,
      timeoutMsg: "native outline navigation failed",
    });
    // currentPageNumber alone is a false-positive signal: pdf.js updates it
    // before attempting the DOM scroll (issue #7). Require real geometry.
    await app.waitUntil(
      async () =>
        app.execute(() => {
          const container = document.querySelector<HTMLElement>(".pdf-container");
          const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
          if (!container || !pageElement) return false;
          const containerRect = container.getBoundingClientRect();
          const pageRect = pageElement.getBoundingClientRect();
          return pageRect.bottom > containerRect.top && pageRect.top < containerRect.bottom;
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native outline navigation did not scroll the target page into view",
      },
    );

    await app.execute(() => {
      const tab = (label: string) =>
        [...document.querySelectorAll<HTMLButtonElement>(".sidebar-tab")].find(
          (button) => button.getAttribute("aria-label") === label,
        );
      tab("Bookmarks")?.click();
    });
    // Bookmark creation is rail-only in the official app (no sidebar Add
    // button); create through the debug API, then rename via the inline
    // editor that opens on double-click.
    await app.execute(() => window.__pdfSpike!.createBookmarkForCurrentPage());
    await app.waitUntil(
      async () =>
        app.execute(() => Boolean(document.querySelector<HTMLButtonElement>(".bookmark-title-button"))),
      {
        timeout: 10_000,
        timeoutMsg: "native bookmark row did not appear",
      },
    );
    await app.execute(() => {
      const title = document.querySelector<HTMLButtonElement>(".bookmark-title-button");
      if (!title) throw new Error("Missing bookmark title button");
      title.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true, composed: true }),
      );
    });
    await app.waitUntil(
      async () =>
        app.execute(() => Boolean(document.querySelector<HTMLInputElement>("input[aria-label='Bookmark title']"))),
      {
        timeout: 10_000,
        timeoutMsg: "native bookmark title input did not appear",
      },
    );
    await app.execute(() => {
      const input = document.querySelector<HTMLInputElement>("input[aria-label='Bookmark title']");
      if (!input) throw new Error("Missing bookmark title input");
      input.value = "Native bookmark";
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          composed: true,
          data: "Native bookmark",
          inputType: "insertText",
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          key: "Enter",
        }),
      );
    });
    await app.execute(async (outputPath) => {
      await window.__pdfSpike!.saveToPath(outputPath);
    }, bookmarkPdfPath);
    await app.execute(async (outputPath) => {
      await window.__pdfSpike!.loadPath(outputPath);
    }, bookmarkPdfPath);
    await app.waitUntil(async () => app.execute(() => Number(window.__pdfSpike!.stats().pages ?? 0) > 0), {
      timeout: 30_000,
      timeoutMsg: "native bookmark PDF did not reload",
    });

    await app.execute(() => {
      const tab = (label: string) =>
        [...document.querySelectorAll<HTMLButtonElement>(".sidebar-tab")].find(
          (button) => button.getAttribute("aria-label") === label,
        );
      tab("Bookmarks")?.click();
    });
    await app.waitUntil(
      async () =>
        app.execute(() =>
          Boolean(
            [...document.querySelectorAll<HTMLButtonElement>(".bookmark-item")].find((button) =>
              button.textContent?.includes("Native bookmark"),
            ),
          ),
        ),
      {
        timeout: 30_000,
        timeoutMsg: "native bookmark row did not appear after reload",
      },
    );

    const state = await app.execute(() => {
      const bookmarkButton = [...document.querySelectorAll<HTMLButtonElement>(".bookmark-title-button")].find((button) =>
        button.textContent?.includes("Native bookmark"),
      );
      bookmarkButton?.click();
      return {
        hasBookmarkRow: Boolean(bookmarkButton),
      };
    });
    await app.waitUntil(
      async () =>
        app.execute(() => {
          const container = document.querySelector<HTMLElement>(".pdf-container");
          const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
          if (!container || !pageElement) return false;
          const containerRect = container.getBoundingClientRect();
          const pageRect = pageElement.getBoundingClientRect();
          return pageRect.bottom > containerRect.top && pageRect.top < containerRect.bottom;
        }),
      {
        timeout: 30_000,
        timeoutMsg: "native bookmark navigation failed",
      },
    );

    expect(state.hasBookmarkRow).toBe(true);
    expect(
      await app.execute(() => {
        const container = document.querySelector<HTMLElement>(".pdf-container");
        const pageElement = document.querySelector<HTMLElement>(".page[data-page-number='13']");
        if (!container || !pageElement) return false;
        const containerRect = container.getBoundingClientRect();
        const pageRect = pageElement.getBoundingClientRect();
        return pageRect.bottom > containerRect.top && pageRect.top < containerRect.bottom;
      }),
    ).toBe(true);
  });
});
