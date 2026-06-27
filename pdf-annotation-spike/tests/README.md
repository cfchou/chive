# Test foundation

Permanent regression layers:

- `npm run test:e2e` runs Playwright against the Vite browser app.
- `npm run test:native` builds a debug Tauri app and runs WDIO against the native WKWebView.

`window.__pdfSpike` is a dev/test-only API exposed by `src/routes/+page.svelte`.
Specs may use it to load fixtures, summarize annotations, and perform stable editor actions without depending on PDF.js private DOM details for every assertion.

Playwright owns browser regressions; WDIO owns native WKWebView smoke coverage.
