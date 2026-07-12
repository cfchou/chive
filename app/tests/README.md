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

## Frontend coverage

`npm run coverage` runs the unit suite and an instrumented Playwright browser
suite, then writes a merged terminal summary, `coverage/lcov.info`, and a
browsable report at `coverage/html/index.html`. It requires the same local
Playwright and `qpdf` prerequisites as `npm run test:e2e`.

`npm run coverage:accept` reruns the same command and updates the tracked
`tests/coverage-baseline.json` ratchet after an intentional increase. The
baseline uses whole percentage points so normal browser execution variance
does not make the gate flaky. The coverage percentage covers app-owned
TypeScript and Svelte source, excluding
the test-only debug harness. Native WKWebView smoke remains a separate
behavior gate and does not contribute line-coverage counters.
