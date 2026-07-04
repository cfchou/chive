# ADR 0010: Defer Vim-like PDF Text Cursor as a Product Direction

Status: Accepted

Date: 2026-07-04

## Context

We explored a Vim-like reading cursor for PDFs in the Tauri/PDF.js spike app.

The desired user experience was:

- press `p` to focus the PDF in normal mode
- show a visible caret on PDF text
- press `w` to move to the beginning of the next word
- press `v` to enter visual mode
- move by words to extend a text selection
- press `Enter` to create a PDF highlight from the visual selection
- degrade clearly when the PDF is image-only or has no selectable text

This was attractive because it could make PDF reading feel closer to Vim:

- fast keyboard movement
- no mouse required for simple text selection
- explicit selected text for annotation or future AI context

## Beginner Mental Model

A PDF page is not a normal web page or text editor.

In a normal text editor, text exists as one editable buffer. A caret can move between characters because the editor owns the text layout.

In PDF.js, the page is split into layers:

- the canvas layer draws the visible PDF pixels
- the text layer adds invisible or lightly styled HTML text for selection
- the annotation/editor layers handle PDF annotations

The visible text and the selectable text are related, but they are not the same thing.

For example, the visible word can be drawn on canvas from embedded PDF font data, while the selectable word can come from an absolutely positioned HTML span. Those two paths can disagree by a few pixels.

## Terms

- PDF.js: JavaScript library that renders and edits PDFs in the browser.
- Tauri: desktop shell that runs the Svelte app inside a native WebView.
- WKWebView: macOS WebKit WebView used by Tauri.
- Chromium: browser engine used by Chrome and Playwright browser tests.
- Canvas layer: PDF.js layer that paints the page pixels.
- Text layer: PDF.js layer of positioned HTML spans used for text selection.
- DOM Range: browser API that selects a range of text nodes.
- Caret: vertical cursor line shown at the current word.
- Visual mode: mode where cursor movement extends a selection.

## What We Built in the Spike

The experimental implementation used a custom PDF cursor model:

1. Read rendered text nodes from the PDF.js text layer for the current page.
2. Split text nodes into words.
3. Compute word rectangles with browser `Range.getClientRects()`.
4. Sort words by visual position instead of raw PDF text stream order.
5. Draw our own caret overlay in the PDF container.
6. Draw our own visual-mode selection overlay from word rectangles.
7. Create a real browser selection only at highlight creation time, so PDF.js can create a PDF highlight.

We also added defensive handling for browser differences:

- When `Range` returns a full text item instead of a word rectangle, fall back to measured text ratios inside the parent span.
- Use PDF.js `--font-height` for caret height because DOM `Range` height can be much smaller than the visible PDF text.
- Keep browser Playwright tests and native WDIO Tauri smoke tests because Chromium and WKWebView can diverge.

## What Worked

The spike proved that the feature is feasible for some normal digitally generated PDFs:

- `p` can focus PDF normal mode.
- `w` can move by rendered word order.
- `v` can enter visual mode.
- visual mode can build a custom selection overlay.
- `Enter` can create a PDF highlight from visual mode.
- image-only PDFs can show a clear no-selectable-text fallback.
- browser and native smoke tests can cover parts of this behavior.

## What Stayed Fragile

The alignment problem is the core issue.

The caret can align to the PDF.js text layer but still look slightly wrong against the visible canvas pixels.

That happens because the cursor uses text-layer geometry, while the human sees canvas-rendered glyphs. These can differ because of:

- embedded font differences
- browser font substitution
- kerning
- ligatures
- glyph side bearings
- synthetic spaces
- fragmented PDF text items
- text stream order that differs from visual order
- columns and sidebars
- rotated or skewed text
- vertical writing
- RTL and bidi text
- unrendered or virtualized pages
- OCR text layers over scanned pages
- browser engine differences between Chromium and WKWebView

Even using PDF.js `getTextContent()` and viewport transforms would not make this universal. It would reduce dependency on the DOM text layer, but word boundaries and glyph positions can still be imperfect because PDFs do not always encode text as words in natural reading order.

## Decision

Do not continue pursuing a precise Vim-like PDF text cursor as a primary product direction right now.

Keep the result as an experimental branch/spike artifact, but move the spike out of next candidates.

The current approach is acceptable only as a best-effort prototype for common text PDFs. It should not be treated as a general PDF text-navigation foundation.

## Why

The feature creates a high expectation: a caret should visually sit exactly where the text begins.

For PDFs, that expectation is expensive to satisfy across real-world documents. The app would need to keep reconciling multiple geometry sources:

- PDF text items
- text layer spans
- browser ranges
- canvas pixels
- PDF.js annotation creation behavior
- native WKWebView behavior

Each source can be correct in one case and wrong in another.

This makes the feature risky for a core reading workflow.

## Preferred Future Directions

Prefer interaction models that admit PDF geometry limits instead of pretending PDFs are text editors.

Better directions:

- command registry and configurable keybindings for scrolling, pages, sidebars, and commands
- label/region mode for selecting visible words or page areas without a persistent caret
- normal browser/PDF.js text selection for text highlights where it works
- region screenshot selection for AI context and image-only PDFs
- explicit selection-to-chat with page number and bounding boxes
- annotation/sidebar workflows that use PDF geometry but do not require pixel-perfect caret placement

If we revisit keyboard text selection later, treat it as best-effort and design the UI around that limitation.

## Consequences

Good:

- avoids building a product-critical workflow on fragile geometry
- keeps the app focused on reliable PDF annotation and navigation
- preserves lessons and tests from the spike
- leaves room for label/region selection, which fits PDFs better

Bad:

- no true Vim-like text cursor in the near term
- keyboard-only text selection remains limited
- visual selection-to-highlight is not ready to become a core feature

## Verification from the Spike

The experimental branch reached this verification before the decision:

- `npm run check`
- `npm run build`
- `npm run test:e2e`
- `npm run test:native`

The tests proved the implementation behavior inside controlled fixtures. They did not prove universal visual alignment against all PDF canvas-rendered text.
