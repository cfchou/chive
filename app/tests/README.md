# Test foundation

Permanent regression layers:

- `npm run test:unit` runs node:test over the pure lib modules in `tests/unit`.
- `npm run test:e2e` runs Playwright against the Vite browser app (port 1430).
- `npm run test:native` builds a debug Tauri app and runs WDIO against the native WKWebView.

`window.__pdfSpike` is a dev/test-only API exposed by `src/routes/+page.svelte`
(the name is kept from the reference implementation so its specs transplant
unchanged). Specs may use it to load fixtures, summarize annotations, and
perform stable editor actions without depending on PDF.js private DOM details
for every assertion.

Playwright owns browser regressions; WDIO owns native WKWebView smoke coverage.
The suites were transplanted from `../pdf-annotation-spike/tests` with
selector adaptations for the official UI (icon toolbar, dockable sidebar tabs,
rail-only bookmark creation, shared row palette, status live region).
