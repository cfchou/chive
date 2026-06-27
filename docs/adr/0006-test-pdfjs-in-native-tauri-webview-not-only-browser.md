# ADR 0006: Test PDF.js Behavior in the Native Tauri WebView, Not Only the Browser

Status: Accepted

Date: 2026-06-26

## Context

The spike runs in two similar but not identical environments:

- browser dev server, usually Chromium-based automation
- packaged Tauri app on macOS, using the system WebKit/WKWebView

Both run the same Svelte/TypeScript app. But "same JavaScript app" does not mean "same runtime behavior".

## Terms

- WebView: browser engine embedded inside a desktop app.
- WKWebView: Apple's WebKit-based WebView used by Tauri on macOS.
- Chromium: browser engine used by Chrome and many automation tools.
- PDF.js worker: separate JavaScript worker that parses PDF bytes and sends render/text data back to the UI.
- `getTextContent()`: PDF.js API that returns text items for a page.
- `streamTextContent()`: PDF.js API that streams text items in chunks.

## Problem

The browser regression harness passed, but the native Tauri app still failed to show annotation snippets.

Root cause: PDF.js text extraction behaved differently in WKWebView than in the browser harness. The code path using `getTextContent()` failed in the native app, so the sidebar could not recover highlighted text from PDF geometry.

This was hard to see because:

- the page rendered correctly
- annotations rendered correctly
- browser automation passed
- macOS screenshots from automation were unreliable
- the failure was in sidebar metadata, not page pixels

So one important lesson: browser tests are necessary, but not sufficient for a Tauri PDF app.

## Decision

Treat the native Tauri WebView as a separate compatibility target.

For PDF.js page text extraction:

1. Prefer `streamTextContent()` when available.
2. Read the stream manually through `getReader().read()`.
3. Fall back to `getTextContent()` only when streaming is unavailable.

This avoids relying on a PDF.js/browser path that worked in Chromium but failed in WKWebView.

## Why

PDF.js is a complex browser library. It uses workers, streams, typed arrays, canvas, DOM layers, and browser APIs. Those pieces can differ across browser engines.

The app also uses PDF.js editor internals, not only stable high-level document rendering. That increases the need for native smoke testing.

Manual stream reading is boring but explicit. It makes the code depend on the common `ReadableStream` reader API instead of a higher-level path that may use engine-specific behavior internally.

## Implementation Notes

The spike uses a helper:

```ts
async function getPageTextItems(page) {
  if (typeof page.streamTextContent === "function") {
    const reader = page.streamTextContent().getReader();
    const items = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && Array.isArray(value.items)) {
        items.push(...value.items);
      }
    }
    return items;
  }
  const textContent = await page.getTextContent();
  return Array.isArray(textContent.items) ? textContent.items : [];
}
```

The exact code is typed in the app, but the logic is the important part.

## Debugging Rule

When browser harness passes but native app fails:

1. confirm whether the bug is native-only
2. add a temporary native debug hook if needed
3. inspect PDF.js data, not only screenshots
4. remove the debug hook after root cause is confirmed
5. add a browser regression if the behavior can be reproduced there

## Consequences

Good:

- annotation snippets work in the packaged macOS app
- the code is less dependent on one browser engine
- future native-only PDF.js bugs have a clear debugging path

Bad:

- browser automation cannot prove all native behavior
- some native checks may still require opening the packaged app
- temporary native debug hooks must be carefully removed after diagnosis

## Verification

The fix was verified by:

- running the browser regression harness
- building the Tauri app bundle
- opening the packaged macOS app
- confirming native snippet extraction returned real highlight text instead of fallback text

