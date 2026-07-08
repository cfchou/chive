# AGENTS

- When using `/teach` skill, put all generated artifacts under `./learning/{topic}`.

- `app/` is the official app directory; run repo commands from there.
  `pdf-annotation-spike/` is the de-risking reference implementation — keep it
  intact; do not edit it unless explicitly asked. UI reference lives in
  `tmp/index.html` + `tmp/ui-spec.md`.

- Frontend is a SPA SvelteKit app for Tauri (`ssr = false`, `adapter-static` with SPA fallback), so assume no SSR data-shape and keep route-level assumptions browser-side.

- Use this command sequence when touching UI/type-level code: `npm run check` (must pass, 0 errors 0 warnings) before `npm run build`.

- Install and core commands:
  - `cd app && npm install`
  - `npm run dev` (Vite at `http://127.0.0.1:1430/`; the spike keeps 1420 so both can run side by side)
  - `npm run build`
  - `npm run tauri -- dev`
  - `npm run tauri -- build`

- `app/src-tauri/src/lib.rs` owns filesystem IO via Tauri commands (`read_pdf`, `write_pdf_atomic`); writes use a hidden temp file then atomic rename, and keep `*.bak` backup. File open/save UX is the native macOS File menu (`app/src/lib/tauri/menu.ts`); the browser build is driven through `window.__pdfSpike` instead.

- Regression safety is non-optional for PDF editor behavior (run in `app/`):
  - Unit: `npm run test:unit`.
  - Browser regressions: `npm run test:e2e` (needs `qpdf` on PATH).
  - Native WKWebView smoke: `npm run test:native`.
  - Combined local regression: `npm run test:regression`.
  - Full gate: `npm run test:unit && npm run check && npm run build && npm run test:e2e && npm run test:native`.

- Pinned dependencies are load-bearing: `pdfjs-dist@6.0.227` (pdfjs-quirks
  targets private editor internals), `svelte@5.56.4`, `@sveltejs/kit@2.67.0`,
  `@wdio/tauri-service@1.0.0` + `@wdio/tauri-plugin@1.0.0` (1.2.0 pairs with an
  incompatible `@wdio/native-utils`). Do not bump casually.

- Use `docs/adr/*.md` as executable project memory for behavior-sensitive edits:
   - `docs/adr/0003-bundle-pdfjs-wasm-decoders-for-scanned-pdfs.md`
   - `docs/adr/0005-derive-annotation-sidebar-data-from-pdf-geometry.md`
   - `docs/adr/0006-test-pdfjs-in-native-tauri-webview-not-only-browser.md`
   - `docs/adr/0007-add-native-wkwebview-smoke-tests-with-wdio-tauri.md`
   - `docs/adr/0008-llm-generated-speculative-coverage-drafting.md`
   - `docs/adr/0013-transplant-spike-into-official-app.md`

- Do not treat browser tests as final for PDF.js behavior: scanned/image PDFs and text extraction differ in WKWebView, so verify critical annotation/text-flow changes with `npm run test:native` after browser regression.
