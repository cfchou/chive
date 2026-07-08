# Tests

Chive uses three test layers.

## Unit

```sh
npm run test:unit
```

Covers pure helpers for annotation keys, bookmark rail geometry, colors, dock state, outline trees, PDF outline byte writing, PDF.js quirks, and debug API installation.

## Browser E2E

```sh
npm run test:e2e
```

Playwright runs against the browser SPA on pinned port `1440`. It covers PDF rendering, annotation lifecycle, sidebars, outline colors, bookmarks, toolbar colors, tool popovers, and docked shell behavior.

Browser tests are the broad regression suite, but they are Chromium-only.

## Native Smoke

```sh
npm run test:native
```

This builds `src-tauri/target/debug/chive` with the WDIO feature and runs WDIO Tauri against the real macOS WKWebView.

Native smoke covers:

- sample PDF render and sidebar text extraction
- persisted ink row focus in WKWebView
- missing, broken, and colored outlines
- native PDF bookmark save/reopen/navigation

Run native smoke after critical PDF.js changes because scanned PDFs, text extraction, annotation editor behavior, and WebView event timing can differ from browser automation.

## Combined Gate

```sh
npm run test:unit
npm run check
npm run build
npm run test:e2e
npm run test:native
```

`npm run test:regression` combines browser and native regression after the app has already passed unit/check/build.
