# PDF IR coordinate proof

This spike proves item 0 in `tmp/design.md`.

## What the proof does

The Rust test creates seven small PDFs. It reads them with
`pdf_oxide@0.3.77`.

Each PDF contains two text labels. `H-AXIS` runs from left to right, along the
positive x-axis. `R-AXIS` runs from bottom to top, along the positive y-axis.
These directions refer to the PDF before page rotation.

`pdf_oxide::PdfDocument::extract_structured()` returns one box for each text
span. It returns that box in absolute, unrotated PDF user space. It does not
apply the page's `/Rotate` value to the box.

`pdf_oxide` reports each span box as if its text follows the x-axis. The
`TextSpan.rotation_degrees` field gives the turn from the positive x-axis.
The Rust test turns the four box corners by this value. This step makes one box
that covers the text in its source direction.

The browser test loads each PDF with `pdfjs-dist@6.0.227`. It uses scale `0.75`
for zoom-out, `1.35` for the baseline, and `2` for zoom-in.
`PageViewport.convertToViewportRectangle()` is a pdf.js function. It changes
the PDF box into a box on the displayed page. The test draws this box and
compares it with the pdf.js text layer.

## Fixtures

The fixtures isolate these page conditions:

- `plain.pdf`: `/Rotate 0`, MediaBox `[0, 0, 400, 600]`, and no CropBox.
  This fixture is the baseline.
- `rotate-90.pdf`: `/Rotate 90` and the baseline MediaBox.
  This fixture checks a 90-degree page rotation.
- `rotate-180.pdf`: `/Rotate 180` and the baseline MediaBox.
  This fixture checks a 180-degree page rotation.
- `rotate-270.pdf`: `/Rotate 270` and the baseline MediaBox.
  This fixture checks a 270-degree page rotation.
- `crop-offset.pdf`: `/Rotate 0`, the baseline MediaBox, and CropBox
  `[40, 60, 360, 540]`. This CropBox starts away from `[0, 0]`.
- `rotate-90-crop-offset.pdf`: `/Rotate 90`, MediaBox
  `[20, 30, 420, 630]`, and CropBox `[60, 90, 380, 570]`. Both boxes start
  away from `[0, 0]`. The page also has a 90-degree rotation.
- `user-unit-2.pdf`: `/Rotate 0`, the baseline MediaBox, no CropBox, and
  `/UserUnit 2`. Each PDF coordinate unit has twice the default display size.

## Run the proof

In this directory, run:

```sh
npm install
npm test
```

`qpdf` must be available on `PATH`. The main Chive regression suite has the
same requirement. `npm test` writes screenshots and JSON evidence to
`artifacts/`.

## Proof results

The proof establishes:

- `pdf_oxide::Rect.x` is the left edge.
- `pdf_oxide::Rect.y` is the lower edge.
- A corner box is `[x, y, x + width, y + height]`.
- `pdf_oxide::PdfDocument::extract_structured()` does not apply the page's
  `/Rotate` value to its span boxes.
- For `H-AXIS`, `pdf_oxide` sets `rotation_degrees` to `0`. Its box stays
  unchanged.
- For `R-AXIS`, `pdf_oxide` returns a wide `bbox` and sets `rotation_degrees`
  to `90`. The test uses both values to calculate a new tall box. That box
  covers `R-AXIS`.
- `pdf_oxide` does not subtract the CropBox origin from a span box.
- `pdf_oxide` returns the same source box numbers when `/UserUnit` is `2`.
- The displayed page size matches the page box, `/UserUnit`, and scale.
- After pdf.js converts each box, the overlay covers the same displayed text as
  the pdf.js text layer.
- This result passes for all seven PDFs at scales `0.75`, `1.35`, and `2`.

## Implementation contract

- A Geometry Index box stays in absolute, unrotated PDF user space.
- Chive turns the four corners by `TextSpan.rotation_degrees` before it stores
  the box.
- pdf.js applies the CropBox, page rotation, and zoom. It also applies
  `/UserUnit`, which changes the display size of each PDF coordinate unit.

## Limits

This spike stores boxes in `artifacts/boxes.json`, not in the future Geometry
Index format. A later test must confirm that the Geometry Index saves and
reloads each box without changes.

`pdf_oxide::PdfDocument::extract_spans()` uses a different path. That path can
apply the page's `/Rotate` value to its returned boxes. This proof uses
`extract_structured()` because the IR uses that method.
