# AGENTS

- When using `/teach` skill, put all generated artifacts under `./learning/{topic}`.

- `pdf-annotation-spike/` is the app directory; run repo commands from there.

- Frontend is a SPA SvelteKit app for Tauri (`ssr = false`, `adapter-static` with SPA fallback), so assume no SSR data-shape and keep route-level assumptions browser-side.

- Use this command sequence when touching UI/type-level code: `npm run check` (must pass) before `npm run build`.

- Install and core commands:
  - `cd pdf-annotation-spike && npm install`
  - `npm run dev` (Vite at `http://127.0.0.1:1420/`)
  - `npm run build`
  - `npm run tauri -- dev`
  - `npm run tauri -- build`

- `pdf-annotation-spike/src-tauri/src/lib.rs` owns filesystem IO via Tauri commands (`read_pdf`, `write_pdf_atomic`); writes use a hidden temp file then atomic rename, and keep `*.bak` backup.

- Regression safety is non-optional for PDF editor behavior:
  - Browser regressions: `npm run test:e2e`.
  - Native WKWebView smoke: `npm run test:native`.
  - Combined local regression: `npm run test:regression`.

- Use `docs/adr/*.md` as executable project memory for behavior-sensitive edits:
   - `docs/adr/0003-bundle-pdfjs-wasm-decoders-for-scanned-pdfs.md`
   - `docs/adr/0005-derive-annotation-sidebar-data-from-pdf-geometry.md`
   - `docs/adr/0006-test-pdfjs-in-native-tauri-webview-not-only-browser.md`
   - `docs/adr/0007-add-native-wkwebview-smoke-tests-with-wdio-tauri.md`
   - `docs/adr/0008-llm-generated-speculative-coverage-drafting.md`

- Do not treat browser tests as final for PDF.js behavior: scanned/image PDFs and text extraction differ in WKWebView, so verify critical annotation/text-flow changes with `npm run test:native` after browser regression.
