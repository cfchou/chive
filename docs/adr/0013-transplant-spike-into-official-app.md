# ADR 0013: Transplant PDF Annotation Spike into Official Chive App

Status: Accepted

Date: 2026-07-07

## Context

`pdf-annotation-spike/` proved the risky PDF editor behavior:

- PDF.js rendering and editor lifecycle
- annotation create/edit/recolor/delete/save/reopen
- annotation sidebar extraction from PDF geometry
- native PDF outline colors
- Chive bookmarks stored as PDF outline entries
- WKWebView smoke testing through WDIO Tauri

The official implementation now lives in `app/`. The spike remains intact as a reference implementation.

## Decision

Create the official Chive app by transplanting the spike's proven PDF behavior into a new SvelteKit/Tauri app shell.

Keep the spike's behavior contracts where tests depend on them:

- `.pdf-container` is the single absolute scroller.
- `.pdfViewer .page` remains PDF.js-owned.
- `.outline-row-main`, `.bookmark-title-button`, `.bookmark-color-chip`, `.bookmark-color-menu`, `.bookmark-page-marker`, and palette-dot dimensions stay stable.
- `window.__pdfSpike` remains as the debug API during the transplant to avoid churn in browser and native tests.
- The PDF save pipeline remains `savePdfDocumentBytes` plus `writePdfOutlineState` plus Tauri `write_pdf_atomic`.

Adopt official UI shell behavior from `tmp/index.html` and `tmp/ui-spec.md`:

- topbar with compact annotation controls
- two dockable sidebar strips
- pointer-based tab docking
- edge reopen buttons
- dirty-dot indicator instead of visible status strip
- status text in a 1px live region
- rail-only bookmark creation in the UI

## Key Deltas from Spike

- Dev server port is `1440`; HMR is `1441`.
- Sidebar Add Bookmark button is removed; debug API bookmark creation stays for tests and internal automation.
- Outline and bookmark rows share one row palette: default, red, orange, yellow, blue, purple.
- Annotation palette has eight colors: red, orange, yellow, green, cyan, blue, purple, rose.
- Free-text font-size and ink-thickness controls live in toolbar popovers.
- Bookmarks activate the Bookmarks tab after rail/debug creation so row and rail state stay visible together.
- Native binary default is `./src-tauri/target/debug/chive`.

## Consequences

Good:

- Official app starts from the same proven PDF behavior as the spike.
- Browser and native regression suites now run against `app/`.
- The spike remains available for comparison and future de-risking.
- UI chrome can evolve without weakening PDF behavior contracts.

Tradeoffs:

- The debug API still uses the temporary `__pdfSpike` name until a final mechanical rename is worth the test churn.
- Some CSS class names remain behavior contracts rather than pure styling details.
- Native smoke remains required for critical PDF.js behavior because WKWebView differs from Chromium.

## Verification

Accepted gate for this transplant:

```sh
npm run test:unit
npm run check
npm run build
npm run test:e2e
npm run test:native
```

Spot-check the spike separately before deleting or changing spike assumptions.
