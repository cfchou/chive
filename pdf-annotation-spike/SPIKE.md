# PDF Annotation Persistence Spike

Goal: verify whether PDF.js-created annotations persist inside the PDF well enough for P0 annotation persistence.

## Run

```bash
npm run tauri dev
```

Or open the app bundle built by:

```bash
npm run tauri build -- --bundles app
open src-tauri/target/release/bundle/macos/pdf-annotation-spike.app
```

## Test

1. Open a normal text PDF.
2. Choose `Highlight`, select text, and create a highlight.
3. Choose `Text`, click a page, and add a free-text annotation.
4. Save with `Save As`.
5. Reopen the saved PDF in this app.
6. Reopen the saved PDF in Preview, PDF Expert, or Acrobat.

## Pass

- Saved PDF opens without corruption.
- Highlight and free-text annotations are visible in this app.
- Highlight and free-text annotations are visible in at least one external PDF reader.
- App-created annotations can be edited or deleted after reopening in this app.

## Fail

- Saved annotations only work inside PDF.js.
- External readers do not display the annotations.
- Save corrupts common PDFs.
- Editing existing third-party annotations is required but unreliable.

