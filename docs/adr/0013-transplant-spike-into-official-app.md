# ADR 0013: Transplant the Spike into the Official App by Copy, Not Rewrite

Status: Accepted

Date: 2026-07-08

## Context

`pdf-annotation-spike/` proved the product architecture (PDF.js 6 renders and
serializes annotations into the PDF bytes; Tauri 2 does native file IO; native
outline entries carry bookmarks and `/C` colors). Its regression suites — 46
unit, 76 Playwright, 4 native WKWebView tests — encode dozens of hard-won
fixes, especially in the pointer-interaction core (5 of the 15 commits before
the sidebar-extraction refactor were fixes inside `handlePdfPointerDown`).

The official implementation lives in `app/` with a new UI defined by
`tmp/index.html` and `tmp/ui-spec.md` (Atelier Zero design: icon toolbar with a
global annotation color, dockable sidebar tabs, rail-only bookmark creation,
no status strip). The spike stays intact as reference.

The tension: the new UI is a real redesign, but a green-field rewrite of the
orchestration would re-open every editor-lifecycle bug the spike already fixed
and would strand the test suites (their selectors and driving API would match
nothing).

## Decision

1. **Transplant behavior-critical code verbatim; reshape only presentation.**
   The spike's `+page.svelte` script section (viewer construction, editor
   lifecycle, `handlePdfPointerDown` with its `activateExisting*` triplets,
   save pipeline) and its ~360 lines of `:global` pointer-events CSS were
   copied unchanged into `app/src/routes/+page.svelte`; only markup and styles
   were rebuilt to the mock. Pure lib modules and unit tests copied as-is.

2. **Keep the spike's DOM contract where specs pin it.** Structural classes,
   aria-labels, and pixel constants asserted by the transplanted suites
   (`.nav-content`, `.outline-row-main` 20px gutter, `.bookmark-title-button`,
   `.bookmark-page-marker`, 18/14px palette chips, the row chip's literal
   `border-radius: 50%`, `.pdf-container` as the one scroller, the
   `.viewer-shell` JS hook) survive the restyle. Mock class names are used
   only for genuinely new chrome (topbar, tab strips, plate, popovers).

3. **Keep every `status =` message string verbatim** and render status into a
   visually-discreet 1×1 `role="status" aria-live="polite"` node. ~20 browser
   assertions and the native suite's `stats().status` polls depend on those
   strings; the ui-spec's "no status strip" is satisfied visually while the
   strings remain the observable contract.

4. **Keep `window.__pdfSpike` as the debug/test API name** so every spec's
   `page.evaluate`/`execute` calls transplant unchanged. Renaming (e.g. to
   `__chive`) is deferred to a dedicated mechanical commit if ever wanted.

5. **Two-column annotation palette.** The ui-spec's single global color model
   is implemented as `annotationPalette` entries carrying `value` (free text,
   ink, swatch chips) and `highlightValue` (pastel for highlights and
   highlighter-intent ink — dark saturated fills over text are unreadable).
   The yellow/green/blue/rose pastels are the spike's original highlight
   hexes, keeping persisted-color test pins byte-identical. The global color
   dispatch delegates to the spike's separate per-kind recolor paths — they
   look parallel but carry kind-specific quirk handling (ADR 0002/0012).

6. **Shared row palette stores saturated colors, renders tints.** Outline and
   bookmark rows share one palette (no-color + red/orange/yellow/blue/purple).
   `/C` keeps saturated hexes readable in external viewers; rows render
   tinted backgrounds.

7. **Pointer-event tab docking, not HTML5 drag-and-drop.** Playwright cannot
   drive `DataTransfer` and WKWebView DnD is unreliable; the dock model is a
   pure module (`app/src/lib/ui/dock-state.ts`) with unit coverage. The
   default active tab is Outline (spike parity — many specs assume it), not
   the mock's demo state.

8. **Official-app-only additions.** A `ResizeObserver` re-syncs the viewer and
   bookmark-rail geometry when sidebars dock/collapse (the spike's layout
   never resized mid-session). The rail hit-test allows 1px beyond the anchor
   width because pointer events carry integer client coordinates while the
   centered page can sit at half-pixel offsets. The native File menu
   (`app/src/lib/tauri/menu.ts`) must keep its Edit submenu of predefined
   items, or clipboard/undo dies in every WKWebView text field.

## Consequences

- All 87 browser tests (76 transplanted ± enumerated adaptations + 11 new for
  docking, plate, and popovers), 59 unit tests, and the 4 native smoke tests
  run green against the new UI; the interaction core was edited approximately
  zero times during the transplant.
- `app/src/routes/+page.svelte` inherits the spike's size (~4.4k lines). The
  spike's remaining extraction backlog (control-panel split, pointer-core
  restructure-in-place) applies to `app/` and should continue there under the
  same full-gate discipline.
- Version pins are load-bearing: `pdfjs-dist@6.0.227` (private editor
  internals), `@wdio/tauri-service@1.0.0`/`@wdio/tauri-plugin@1.0.0` (1.2.0
  resolves an incompatible `@wdio/native-utils` pairing).
- The spike keeps port 1420; the app uses 1430/1431, so both dev servers and
  either native suite (not concurrently) can run side by side.
