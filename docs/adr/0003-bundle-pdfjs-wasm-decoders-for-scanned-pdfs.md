# ADR 0003: Bundle PDF.js WASM Decoders for Scanned and Image-Based PDFs

Status: Accepted

Date: 2026-06-25

## Context

Not all PDFs contain selectable text. Many are scanned images wrapped in a PDF container.

The spike added scanned/image-only sample PDFs:

- `scansmpl.pdf`
- `image-based-pdf-sample.pdf`

These PDFs are important because users will annotate papers, letters, scans, forms, and screenshots. Highlighting selected text does not apply there, but free-text and ink annotations still must work.

## Problem

`scansmpl.pdf` initially rendered as mostly blank with a broken red document icon. It looked like an app rendering failure.

Investigation showed:

- The PDF is a one-page scanned image PDF.
- The embedded image uses CCITT fax compression.
- PDF.js needs its image decoder WASM assets for this class of image.
- The app called `pdfjsLib.getDocument({ data })` without a `wasmUrl`.

Without the decoder path, PDF.js could not fully decode some scanned PDF images.

## Decision

Bundle the PDF.js WASM decoder assets in the app and pass the decoder URL to PDF.js:

- `jbig2.wasm`
- `jbig2_nowasm_fallback.js`
- `openjpeg.wasm`
- `openjpeg_nowasm_fallback.js`
- `qcms_bg.wasm`

The app serves them from:

```text
/pdfjs-wasm/
```

PDF loading uses:

```ts
pdfjsLib.getDocument({
  data: bytes,
  wasmUrl: "/pdfjs-wasm/",
});
```

## Why

PDF.js is split into the main renderer, worker, and optional decoder assets. A desktop app must package all runtime assets it expects PDF.js to load.

This is easy to miss because normal text PDFs can render fine without these assets. The failure only appears with image encodings that need extra decoders.

## Important Clarification

After fixing the decoder path, one red icon still appears in `scansmpl.pdf`.

That icon is part of the scanned source image itself. Poppler renders the same icon outside the app, so it is not an app bug.

## Consequences

Good:

- Scanned and image-based PDFs render correctly.
- Free-text and ink annotation persistence can be tested on image-only PDFs.
- Tauri production builds include the same decoder assets used in dev.

Bad:

- App bundle size increases.
- We must keep decoder assets in sync with the installed `pdfjs-dist` version.
- Updating PDF.js should include checking whether decoder asset names changed.

## Verification

The regression harness now includes a canvas pixel-density check. This prevents a broken placeholder or blank page from passing just because annotation APIs still work.

The harness also runs on:

- a normal text PDF
- `scansmpl.pdf`
- `image-based-pdf-sample.pdf`
- the bundled sample PDF

