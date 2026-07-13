# Chive

The official implementation of the Chive PDF reader/annotator: a SvelteKit SPA
(Svelte 5, `ssr = false`, adapter-static) running inside Tauri 2 on macOS.

It was transplanted from the de-risking reference implementation in
`../pdf-annotation-spike/` (kept intact); the UI follows `../tmp/index.html`
and `../tmp/ui-spec.md` (Atelier Zero design). See
`../docs/adr/0013-transplant-spike-into-official-app.md` for the transplant
decisions, and the older ADRs in `../docs/adr/` for the behavior-sensitive
areas they still govern.

## What it does

- Renders PDFs with pdf.js 6 (`PDFViewer`, wasm decoders under
  `static/pdfjs-wasm/` for scanned PDFs — ADR 0003).
- Creates highlight / free text / ink annotations via the pdf.js annotation
  editor; annotations persist **into the PDF bytes** (`saveDocument()` +
  atomic write with `.bak` backup — ADR 0001).
- Bookmarks and outline colors persist as native PDF outline entries
  (`My Bookmarks` subtree, `/C` colors — ADR 0011) through a raw
  incremental-update byte writer.
- Bookmarks are created only from the page-left hover rail (ui-spec).
- File open/save is a native macOS File menu (⌘O / ⌘S / ⇧⌘S); the browser
  build has no file UI and is driven through the `window.__pdfSpike` debug API.

## Commands (run from `app/`)

- `npm install`
- `npm run dev` — Vite at `http://127.0.0.1:1430/` (the spike uses 1420, so
  both can run side by side); parallel worktrees override the port with
  `CHIVE_E2E_PORT=1440 npm run dev` (see `tests/README.md`)
- `npm run check` — svelte-check (keep at 0 errors / 0 warnings)
- `npm run build`
- `npm run tauri -- dev` / `npm run tauri -- build`

## Tests

- `npm run test:unit` — node:test over `tests/unit` (pure lib modules)
- `npm run test:e2e` — Playwright browser regressions (needs `qpdf` on PATH)
- `npm run coverage` — merged unit + instrumented-browser coverage on its own
  server (port 1432 by default; override with `CHIVE_COVERAGE_PORT`)
- `npm run test:native` — WDIO smoke against the native WKWebView build
- Full gate: `npm run test:unit && npm run check && npm run build && npm run test:e2e && npm run test:native`

Browser green is not final for PDF.js behavior — WKWebView differs (ADRs
0006/0007); run the native suite for annotation/text-flow changes.

In browser dev there are no open/save controls; load a PDF from the console:

```js
window.__pdfSpike.loadUrl("/sample.pdf");
```
