# ADR 0012: Treat InkHighlight Annotations as Highlight-Intent Ink

Status: Accepted

Date: 2026-07-05

## Context

The annotation sidebar lists persisted PDF annotations from the opened PDF.

For normal highlight and free-text Annotation Sidebar Entries, clicking an Annotation Sidebar Entry can locate the annotation and expose the small PDF.js editor toolbar for actions such as recolor or delete.

For some persisted ink Annotation Sidebar Entries in the bundled sample PDF, clicking the entry located the annotation on the page but did not expose the ink editor toolbar.

The confusing part was that all of these entries looked like "ink" in the sidebar. Some ink entries behaved like editable pen strokes, while other ink entries only behaved like locate targets.

The affected annotations in `static/sample.pdf` were:

- page 2, second ink Annotation Sidebar Entry
- page 2, third ink Annotation Sidebar Entry
- page 3, second ink Annotation Sidebar Entry

## Beginner Mental Model

A PDF annotation is stored as a dictionary.

For example:

```pdf
<<
  /Subtype /Ink
  /IT /InkHighlight
  /BS << /W 12 >>
  /C [ 1 0.9529411765 0.3607843137 ]
  /InkList [ ... ]
>>
```

The syntax is dense, but the idea is simple:

- `<< ... >>` means a PDF dictionary, similar to an object with key-value pairs.
- `/Something` means a PDF name. Names are used for keys and enum-like values.
- `/Subtype /Ink` means this annotation is stored as an ink annotation.
- `/InkList` stores one or more drawn paths.
- `/BS << /W 12 >>` stores border style. `/W` is stroke width in PDF points.
- `/C [ ... ]` stores annotation color.
- `/IT /InkHighlight` stores annotation intent. In this case, the intent is highlighter-style ink.

An indirect object reference such as `567 0 R` points to a PDF object elsewhere in the file. In discussion we often shorten that to `567R`, but the real PDF syntax includes the generation number: `567 0 R`.

Important distinction:

- `/Subtype` tells the broad annotation type.
- `/IT` can refine the intended behavior of that annotation type.

So `/Subtype /Ink` does not always mean "normal pen scribble." It can also mean "ink annotation with highlighter intent" when `/IT /InkHighlight` is present.

## Terms

- Ink annotation: PDF annotation whose `/Subtype` is `/Ink`.
- Ink list: the `/InkList` path data for an ink annotation.
- Annotation intent: the `/IT` field, which gives a more specific intended use for some annotations.
- InkHighlight: the `/IT /InkHighlight` intent value used for highlighter-style ink.
- Border style: the `/BS` dictionary. Its `/W` value is stroke width.
- Appearance stream: the `/AP` entry. It can define exactly how the annotation should render.
- PDF.js editor toolbar: the floating UI PDF.js shows when an annotation editor is selected.
- Locate-only annotation: an annotation the app can scroll to and outline, but cannot activate as the expected PDF.js editor type.

## Evidence from the Bundled Sample PDF

The sample PDF contains both plain ink and highlighter-intent ink.

Observed objects:

| Page | Object | Key fields | Meaning in this app |
| --- | --- | --- | --- |
| 2 | `561 0 R` | `/Subtype /Ink`, no `/IT`, `/BS << /W 1 >>`, red color | normal red pen stroke |
| 2 | `567 0 R` | `/Subtype /Ink`, `/IT /InkHighlight`, `/BS << /W 12 >>`, yellow color | highlighter-style ink |
| 2 | `568 0 R` | `/Subtype /Ink`, `/IT /InkHighlight`, `/BS << /W 12 >>`, yellow color | highlighter-style ink |
| 3 | `573 0 R` | `/Subtype /Ink`, no `/IT`, `/BS << /W 1 >>`, black color | normal black pen stroke |
| 3 | `574 0 R` | `/Subtype /Ink`, `/IT /InkHighlight`, `/BS << /W 12 >>`, yellow color | highlighter-style ink |

This explains the visible pattern:

- the editable ink objects are normal pen strokes
- the non-editable-as-ink objects are ink annotations with highlighter intent

## Locate Box Geometry

For highlighter-intent ink, the PDF annotation `/Rect` is a padded annotation hit box. It is not always the tight visual mark.

For example, page 2 object `568 0 R` has:

```pdf
/Rect [ 83.9393103218 50.3984559238 382.8574161959 70.3869078255 ]
/InkList [ [ ... 85.1899719238 59.1026535034 ... 382.2621154785 62.9758300781 ] ]
```

The `/Rect` y range is roughly `50.4..70.4`, but the ink path centerline is roughly `57.2..63.5` before stroke width and appearance are applied.

PDF.js renders a DOM annotation section from the broader annotation rectangle. Inside that section, it also renders SVG shape geometry for the ink path. The section is useful for hit testing and fallback location. The SVG shape is a better source for a tight visual locate box.

Decision for locate-only highlighter-intent ink:

- Prefer rendered SVG shape bounds from PDF.js when the annotation element is present.
- Fall back to the annotation entry bounds derived from `/Rect` when rendered shape bounds are unavailable.
- Do not infer editability from either box. Editability remains governed by the `/IT /InkHighlight` policy above.

## PDF Spec Nuance

`/IT /InkHighlight` does not mean "read-only" by itself.

Editability is a viewer/editor behavior, not only a PDF file property.

A PDF annotation can also have flags in `/F`. Those flags can include read-only behavior, but the sample objects use `/F 4`, which is the print flag. That is not the read-only flag.

So the precise statement is:

> The PDF file marks these annotations as highlighter-intent ink, not read-only ink. Current PDF.js behavior then makes that distinction matter for editor activation.

Also, an annotation can have an `/AP` appearance stream. When present, `/AP` can control the rendered pixels even if `/BS`, `/C`, and `/InkList` suggest a different visual style.

That means `/BS /W 12` and yellow `/C` are strong clues for highlighter-style rendering, but `/IT /InkHighlight` is the decisive semantic field in this sample.

## PDF.js Behavior

In the current dependency, `pdfjs-dist` is `6.0.227`.

PDF.js reads ink annotations as `InkAnnotationElement`.

In this version, PDF.js maps the annotation editor type like this:

```js
this.annotationEditorType =
  this.data.it === "InkHighlight"
    ? AnnotationEditorType.HIGHLIGHT
    : AnnotationEditorType.INK;
```

That means:

- `/Subtype /Ink` without `/IT /InkHighlight` becomes an ink editor target
- `/Subtype /Ink` with `/IT /InkHighlight` becomes a highlight editor target

PDF.js also writes `/IT /InkHighlight` when it creates an ink annotation from highlight outlines. This confirms that PDF.js intentionally uses the field to distinguish highlighter-style ink from normal ink.

## Problem

The Annotation Sidebar Entry label "Ink" was too broad.

At the PDF data level, all these annotations were `/Subtype /Ink`.

At the PDF.js editor level, they were not all `AnnotationEditorType.INK`:

- plain `/Ink` entries could activate an ink editor
- `/Ink` plus `/IT /InkHighlight` entries were classified by PDF.js as highlight editor targets

If the app blindly tries to activate every `/Subtype /Ink` entry as an ink editor, some entries will fail. That failure is deterministic for this sample and this PDF.js version, not random timing.

## Decision

Treat `/Subtype /Ink` plus `/IT /InkHighlight` as highlighter-intent ink.

Do not promise the normal ink editor toolbar for these annotations.

The app should:

1. Still list the annotation in the sidebar.
2. Still scroll to and outline the annotation when the Annotation Sidebar Entry is clicked.
3. Avoid presenting it as a normal editable ink pen stroke.
4. Use a locate-only fallback when PDF.js does not expose a compatible editor.
5. Prefer clearer naming in future UI, such as "Ink highlight" or "Highlight ink", if the distinction becomes user-facing.

For implementation policy:

- `/Subtype /Ink` without `/IT /InkHighlight`: try normal ink editor activation.
- `/Subtype /Ink` with `/IT /InkHighlight`: treat as highlighter-intent; locate it reliably, and only expose editing if the app deliberately supports the matching PDF.js highlight editor path.

## Why

The PDF file is the durable source of annotation meaning.

The app should not decide editability only from the broad `/Subtype`.

PDF.js has a second interpretation layer. It converts persisted PDF annotations into editor types. In this case, that layer uses `/IT /InkHighlight` to choose highlight editor behavior instead of ink editor behavior.

Using the same distinction in the app prevents a misleading UI:

- users can still find the annotation
- tests can assert deterministic behavior
- the sidebar does not imply that every `/Ink` object is a pen-stroke editor
- future support for highlighter-intent ink can be added deliberately

## Consequences

Good:

- persisted ink Annotation Sidebar Entry behavior is explainable from PDF object data
- sidebar navigation can be reliable even when editing is unavailable
- tests can separate normal ink from highlighter-intent ink
- future maintainers have a clear reason for locate-only fallback

Bad:

- some entries still look like ink but do not expose the ink editor toolbar
- UI terminology may need refinement
- supporting full edit/delete/recolor for `/IT /InkHighlight` may require a separate highlight-editor path

## Out of Scope

This ADR does not decide:

- whether highlighter-intent ink should be renamed in the sidebar
- whether the app should support editing `/IT /InkHighlight` through the PDF.js highlight editor
- whether `/IT /InkHighlight` should be converted into normal `/Highlight` annotations
- whether other PDF viewers treat these annotations the same way
- whether appearance streams should be parsed to infer marker-like visual style

## Verification

Useful checks:

- Inspect `static/sample.pdf` objects with `qpdf --show-object=<object> static/sample.pdf`.
- Confirm page 2 object `561 0 R` has no `/IT` and behaves as normal ink.
- Confirm page 2 objects `567 0 R` and `568 0 R` have `/IT /InkHighlight`.
- Confirm page 3 object `573 0 R` has no `/IT` and behaves as normal ink.
- Confirm page 3 object `574 0 R` has `/IT /InkHighlight`.
- Confirm current PDF.js maps `data.it === "InkHighlight"` to `AnnotationEditorType.HIGHLIGHT`.
- Keep browser and native regression coverage for Annotation Sidebar Entry clicking because PDF.js editor activation can differ between Chromium and WKWebView.

Required checks for related implementation changes:

- `npm run check`
- `npm run build`
- `npm run test:e2e`
- `npm run test:native`
