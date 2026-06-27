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

- Regression safety is non-optional for PDF editor behavior: run `./scripts/regression-agent-browser.sh` with the dev server up.
  - Default command: `./scripts/regression-agent-browser.sh`.
  - External fixtures: `./scripts/regression-agent-browser.sh --pdf ../tmp/epa_sample_letter_sent_to_commissioners_dated_february_29_2015.pdf` (path must resolve under repo root).
  - Multiple PDFs are supported by repeating `--pdf`; the script increments `PDF_HTTP_PORT` starting at `1421` and uses separate `agent-browser` sessions.
  - The script starts a local HTTP file server and expects CORS-friendly static access, so keep PDFs under repo root (often `tmp/`).

- Use `docs/adr/*.md` as executable project memory for behavior-sensitive edits:
   - `docs/adr/0003-bundle-pdfjs-wasm-decoders-for-scanned-pdfs.md`
   - `docs/adr/0005-derive-annotation-sidebar-data-from-pdf-geometry.md`
   - `docs/adr/0006-test-pdfjs-in-native-tauri-webview-not-only-browser.md`
   - `docs/adr/0007-add-native-wkwebview-smoke-tests-with-wdio-tauri.md`

- Do not treat browser tests as final for PDF.js behavior: scanned/image PDFs and text extraction differ in WKWebView, so verify critical annotation/text-flow changes with a packaged/native run after browser regression.
