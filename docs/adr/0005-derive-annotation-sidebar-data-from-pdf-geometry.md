# ADR 0005: Derive Annotation Sidebar Data from PDF Geometry

Status: Accepted

Date: 2026-06-26

## Context

The reader needs an Annotation Sidebar like PDF Expert:

- each Annotation Sidebar Entry shows annotation type
- highlight entries show the text that was highlighted
- clicking an Annotation Sidebar Entry scrolls the annotated content into view
- clicked annotation gets a temporary dashed focus box
- entry order matches page reading order

This sounds like UI work, but most bugs came from PDF data shape and PDF.js rendering lifecycle.

## Terms

- Annotation Sidebar: the left-panel list of highlights, free-text notes, and ink.
- Persisted Annotation Sidebar Entry: annotation already saved inside the PDF file.
- Live Annotation Sidebar Entry: annotation created in the current PDF.js editor session but not yet saved/reopened.
- `/Contents`: optional PDF annotation comment text. For highlights this is often empty.
- `/Rect`: one bounding rectangle around an annotation. For a multi-line highlight this can be too broad.
- `/QuadPoints`: PDF highlight geometry. It stores one or more four-point boxes around the exact highlighted text lines.
- Text layer: invisible/selectable HTML text that PDF.js puts over the rendered page.
- Text item: one chunk of text returned by PDF.js for a page, with position data.

## Problem

The first sidebar implementation tried to read "what was highlighted" from annotation fields or from rendered DOM. That broke in several ways.

Saved highlight snippets were missing because many PDF highlights do not store selected text in `/Contents`. They store geometry, not text.

Some snippets were wrong because `/Rect` was too broad. It can cover a whole area around the annotation, while the real highlight is only part of a line or several separate line boxes.

Some snippets disappeared after reload or after creating another highlight because PDF.js renders pages, annotation layers, editor layers, and text layers asynchronously. A sidebar refresh can run before the needed DOM exists.

Clicking an existing persisted highlight could create extra "live" entries because PDF.js can materialize a persisted annotation into an editor object when it is selected. The sidebar then saw both the saved annotation and its editor mirror as different entries.

Another failure looked like a scrolling bug but was really an identity bug. The sidebar sorted entries by visual geometry, but click handling still used `targetIndex`, which came from raw PDF annotation order. When two highlights on the same page had a different PDF order than visual order, clicking an entry focused the wrong highlighted text.

Another failure appeared after creating a new annotation on a later page. Page 2 originally had 5 persisted annotations, but after adding 1 annotation on page 5, page 2 showed 10 entries. The extra 5 entries were not real new annotations. They were PDF.js live editor mirrors for existing page 2 annotations.

This happened because PDF.js can keep editor objects for existing PDF annotations even when their page DOM is offscreen. Our previous de-duplication used DOM bounds overlap, but offscreen editor mirrors had no usable DOM bounds, so they escaped the de-duplication check.

Another failure was sidebar sync after editing or deleting. The PDF's raw annotation list still contained the original persisted annotation after PDF.js had marked it deleted or replaced it with a modified editor. If the sidebar only read raw PDF annotations, deleted entries stayed visible and edited entries showed stale text. Also, PDF.js editor commit/delete can finish asynchronously, so one immediate refresh was not always enough.

In native testing, delete still had one more lifecycle gap: the entry disappeared only after an extra mode change such as switching the tool to `None`. This means PDF.js can delay its own persisted-delete marker until an editor mode commit. The sidebar cannot wait for that if the user expects immediate feedback.

Another native-only version of the same bug came from selection identity. When the user clicked a saved annotation in the PDF page, PDF.js converted the rendered annotation into an editor object, but that editor did not always expose `annotationElementId` soon enough. If the sidebar inferred the persisted entry only from the selected editor, the delete handler could not know which saved entry to hide.

A later Chrome repro showed a separate path: pressing the keyboard `Delete` key after selecting an annotation let PDF.js delete the editor directly. That bypassed the app's `Delete Selected` button handler, so the sidebar did not add the pending-delete key or refresh. The annotation disappeared from the page, but its Annotation Sidebar Entry stayed until another UI action caused a refresh.

A repro in the official app (`app/`, after the spike-to-app transplant in ADR 0013) found one more identity/geometry gap: editing a persisted free-text annotation's *text* (no move) reshuffled its position in the sidebar relative to unrelated neighbors on the same page. The sort order is page/top/left as decided above, and a modified persisted annotation is correctly hidden in favor of its live editor stand-in — but that stand-in's `sortTop`/`sortLeft` were being re-measured from the live editor's own DOM rect, which sits a few pixels off from the persisted annotation element's rect (different padding/box model between `.freeTextEditor` and `.freeTextAnnotation`). That skew was enough to cross a neighboring entry's position and visibly reorder the list on a pure text edit that never moved the annotation.

## Decision

Use PDF geometry as the source of truth for persisted Annotation Sidebar Entries.

For persisted highlights:

1. Read annotation geometry from PDF.js annotation data.
2. Prefer `/QuadPoints` when available.
3. Fall back to `/Rect` only when there are no quad points.
4. Read page text items from PDF.js.
5. Convert both annotation geometry and text item geometry into the same viewport coordinate system.
6. Keep text items or characters whose boxes overlap the highlight boxes.
7. Trim partial words at the edges when overlap starts in the middle of a word.

For ordering:

- sort by page number
- then by top coordinate
- then by left coordinate

For clicking an Annotation Sidebar Entry:

- scroll to the annotation page
- center the annotation bounds in the PDF viewport when possible
- draw a thin dashed focus box around the target
- find the real PDF.js annotation element by durable PDF annotation id when possible
- fall back to geometry overlap when id lookup is unavailable
- use list index only as a final fallback
- then click/select the real PDF.js annotation element when editing is possible

For live annotations:

- read editor entries from PDF.js `annotationEditorUIManager`
- skip editor objects whose `annotationElementId` maps to an existing persisted PDF annotation
- show modified existing editor objects as Live Annotation Sidebar Entries, and hide their stale persisted PDF entries
- hide persisted PDF entries that PDF.js marks deleted
- keep a local pending-delete set for persisted annotations immediately after delete, before PDF.js commits the mode change
- when the user clicks a saved annotation element, capture its PDF annotation id and page number before asking PDF.js to activate the editor
- preserve that captured persisted key through editor activation so delete can hide the exact entry even if PDF.js editor metadata is late
- route keyboard `Delete` and `Backspace` for selected annotations through the same app delete handler as the `Delete Selected` button
- do not intercept those keys while focus is inside an editable text field or contenteditable free-text editor
- run immediate and delayed sidebar refreshes after create, edit, recolor, move, and delete operations
- compute DOM bounds for each live editor
- skip a live editor if it significantly overlaps a persisted annotation on the same page
- cache each persisted entry's sort geometry (`sortTop`/`sortLeft`) by its persisted key on every sidebar refresh; when a live editor stands in for a persisted annotation, reuse that cached geometry for sorting instead of re-measuring the live editor's own DOM rect

## Why

The PDF file is the durable source. DOM is only a rendering of that source.

`/QuadPoints` is more precise than `/Rect` for highlights. It describes the actual highlighted boxes, not only the outer bounding box.

Geometry-based extraction works after save/reopen and does not depend on PDF.js adding selected text to `/Contents`.

Overlap-based de-duplication handles PDF.js editor lifecycle. If selecting a saved annotation creates a live editor mirror, the sidebar still shows one Annotation Sidebar Entry.

Display order and activation identity are separate. The entry can be sorted by page position, but click targeting must use annotation identity or geometry. List index is not stable enough.

PDF.js editor objects also have identity. When `annotationElementId` points at a persisted PDF annotation, that editor is a mirror of existing PDF state, not a separate Annotation Sidebar Entry. Geometry overlap is only a fallback; annotation identity must win when present.

The sidebar must merge three states, not just read the PDF file: raw persisted annotations, deleted annotation ids, and modified live editor objects. The current UI state wins over the raw PDF until the user saves and reloads.

Local pending-delete state is allowed because it reflects a user action already accepted by the editor. It is cleared when loading a new PDF. It prevents stale Annotation Sidebar Entries while PDF.js waits for a later mode transition.

The pending-delete key must be captured from the clicked PDF annotation element when possible. Native WKWebView timing can make PDF.js editor metadata lag behind the click, so deriving the key only from `firstSelectedEditor` is not reliable enough.

All delete entry points must share one lifecycle. If keyboard delete goes straight to PDF.js, the page can update but the sidebar state will not.

Sort position must be a property of the *annotation identity*, not of whichever DOM element currently represents it. A persisted annotation and its live editor stand-in are the same logical entry with two different possible renderers (`.freeTextAnnotation` vs `.freeTextEditor`, etc.), and those renderers do not share exact box geometry. Re-measuring on every renderer swap turns an identity concept (page position) into a rendering-detail concept, which is exactly the class of bug this ADR already rejects for click-target identity above.

## Implementation Notes

The spike has helpers for these jobs in `pdf-annotation-spike/src/routes/+page.svelte`:

- `annotationViewportRects()`: converts `/QuadPoints` or `/Rect` into viewport rectangles
- `textForPdfAnnotation()`: extracts snippet text by intersecting annotation rectangles with page text
- `numbersFromUnknown()`: normalizes plain arrays and typed arrays from PDF.js
- `pdfAnnotationBounds()`: computes page-relative annotation bounds
- `annotationTargetBounds()`: computes page-relative live editor bounds
- `boundsOverlapSignificantly()`: removes duplicate persisted/live entries
- `annotationTargetElementForEntry()`: resolves the clicked entry to the correct rendered annotation element
- `persistedSourceIdForEditor()`: maps a PDF.js editor mirror back to the persisted PDF annotation id
- `isPersistedAnnotationHidden()`: hides deleted or modified persisted entries from the sidebar
- `rememberPersistedAnnotationElement()`: captures page plus PDF annotation id from the clicked saved annotation before PDF.js creates/selects an editor
- `persistedAnnotationKeyByEditorId`: preserves that captured entry identity after PDF.js creates/selects an editor
- `pendingDeletedPersistedAnnotationKeys`: immediately hides deleted persisted entries before PDF.js commits its delete marker
- `handleAnnotationDeleteKey()`: sends keyboard delete/backspace through the app delete lifecycle unless the user is editing text
- `queueEditorStateRefresh()`: repeats sidebar refresh after async PDF.js editor updates
- `isDuplicateLiveAnnotation()`: prevents duplicate live entries from one editor operation
- `cachedAnnotationDetail()`: keeps a useful snippet if a later refresh temporarily has less information

In `app/src/routes/+page.svelte` (the official app, post-transplant): `persistedPositionByKey` is a `Map` from persisted annotation key to its last-known `{ top, left }`, populated every `refreshAnnotationSidebar()` from the persisted entries and consulted by the live-entry `positionForEditor` callback before falling back to a fresh DOM measurement.

## Consequences

Good:

- persisted highlight entries can show useful snippet text
- entry order is stable and tied to page position
- clicking an entry can center and mark the target
- selecting persisted annotations no longer creates duplicate Annotation Sidebar Entries
- editing an annotation's content in place no longer reorders it relative to unrelated neighbors

Bad:

- text extraction is approximate because PDF text items are not always one character per visual glyph
- rotated text, unusual writing modes, and complex scripts may need better geometry handling later
- sidebar code now knows about PDF concepts such as `/QuadPoints`

## Verification

Regression tests cover:

- snippets exist after loading a PDF
- snippets survive second load
- snippets still exist if the annotations tab is selected before load
- snippets remain after adding another highlight
- snippets do not start with known partial-word fragments
- clicking a persisted Annotation Sidebar Entry does not add duplicate live entries
- clicking each persisted highlight Annotation Sidebar Entry focuses text matching that entry's snippet
- adding a new annotation on a later page does not duplicate persisted entries on earlier pages
- deleting a persisted annotation removes its Annotation Sidebar Entry before save/reopen
- deleting a persisted annotation updates the sidebar without requiring a tool change to `None`
- deleting a selected annotation with keyboard `Delete` updates the sidebar without requiring a tool change to `None`
- editing a persisted free-text annotation updates the Annotation Sidebar Entry without changing the count
- editing a persisted free-text annotation's content keeps its sidebar sort position among unrelated same-page entries (`app/tests/e2e/annotations-sidebar.spec.ts`, "text-editing a persisted free text keeps its sidebar sort position")
- creating a new annotation adds one Annotation Sidebar Entry without duplicating existing entries
- focus box appears around the clicked annotation target
