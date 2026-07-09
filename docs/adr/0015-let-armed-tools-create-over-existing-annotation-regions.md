# ADR 0015: Let an Armed Creation Tool Draw Over an Existing Annotation's Region

Status: Accepted

Date: 2026-07-09

## Context

`handlePdfPointerDown` in `app/src/routes/+page.svelte` is the pointer-core
function ADR 0013 calls out as carrying most of the spike's hard-won
interaction fixes. It has to route a single pointerdown to one of several
outcomes: start creating a new annotation, select an existing one, enter
edit mode on a double-click-adjacent target, or do nothing. ADR 0005
separately established that finding "which annotation is under this pixel"
has to be geometry-based (via `annotationEntryForPointerTarget`), because
annotation hit targets — especially thin ink strokes and multi-box highlight
`/QuadPoints` — are often much smaller or oddly shaped compared to their
full bounding rect, so a DOM-target-only check would miss them for the
sidebar's locate/click-to-select purposes.

## Problem

`handlePdfPointerDown` reused that same geometry-based lookup to gate
*creation*, not just selection. With any tool armed (Highlight, Free Text,
or Ink) and nothing already selected, a pointerdown whose (x, y) fell inside
*any* existing annotation's geometry — even empty padding inside a
free-text box's rect, or open space inside a wide highlight rect the
pointer wasn't visually over — was treated as "clicked that annotation" and
swallowed the event before it could reach pdf.js's own creation path. The
practical effect: a user could not start a new annotation anywhere whose
on-page rectangle overlapped an existing one, regardless of whether their
pointer was actually over that annotation's rendered content. Nobody
decided this as a product policy; it fell out of two different jobs
(locate-for-sidebar, gate-for-creation) sharing one generous hit-test.

## Decision

Split "hit" into two kinds inside the creation-mode branch of
`handlePdfPointerDown`:

- **Visual hit** — the pointerdown's DOM target is literally inside the
  annotation's own rendered content: a free-text editor's text, an ink
  editor's stroke hit-area, or an editor's `editToolbar`. These still
  reserve the click for the existing select/edit routing, unchanged — this
  is exactly what the double-click-to-edit specs (ADR 0002) pin.
- **Geometry-only hit** — the pointerdown's DOM target is *not* inside the
  annotation's rendered content, but `annotationEntryForPointerTarget`
  still matched it by position (per ADR 0005's generous, sidebar-oriented
  hit-test). In pure creation mode (a tool armed, nothing selected), this no
  longer blocks the tool: the event passes through to pdf.js's own creation
  path.

**Highlight editors are classified as geometry, not visual, for this
decision.** A live highlight editor renders as a rect-sized, fully
interactive DOM element — unlike free-text's tight glyphs or ink's thin
stroke — so almost every point "inside" a highlight is also a literal DOM
hit on the editor. Classifying that as visual would still block creation
over any highlight and defeat the point of this change. The trade-off:
**double-click-to-edit an existing highlight no longer works while a
creation tool is armed.** Highlights remain reachable for edit via
selection-mode (no tool armed) double-click and via the Annotations
sidebar — neither of which changed.

This routing fix alone wasn't sufficient for highlights: pdf_viewer.css
independently re-enables pointer events on a highlight editor's `.internal`
across its whole rect, which both stole the pointerdown ahead of this JS
logic and kept pdf.js's own layer from seeing itself as the event target
(required for it to start creating). See ADR 0014 for that CSS-side fix;
the two changes were both required together.

## Why

Reusing one hit-test for two different jobs had created an undocumented,
accidental policy — "you can never draw over an existing annotation's
rect" — that nobody chose on purpose and that got more restrictive than
intended as more annotations accumulated on a page. Making the visual/
geometry distinction explicit turns that into a decision instead of a side
effect, and keeps the two jobs (sidebar locate, creation gating) free to
evolve independently.

## Consequences

Good:
- Tools can create annotations that visually overlap or stack with existing
  ones — e.g. a free-text note inside a highlighted paragraph — matching
  common PDF-editor UX.

Bad / accepted trade-off:
- Highlight double-click-to-edit is unavailable while any creation tool is
  armed; the user must switch to selection mode (no tool) or use the
  sidebar. This is deliberate, not an oversight — revisit if it turns out
  to be the wrong call in practice.

Open question (not needed by current reports, flagged for later): should
free-text/ink someday get a similar visual/geometry split so double-click-
edit degrades more gracefully in dense annotation areas, the way highlight
now does? No evidence yet that this is needed.

## Verification

- `tests/e2e/annotation-lifecycle.spec.ts`: "ink tool draws a new stroke
  starting inside an existing highlight region", "free text tool creates
  inside an existing highlight region".
- Existing double-click-to-edit specs for free-text and ink pass unmodified,
  confirming visual-hit routing is untouched for those kinds.
- Native WKWebView smoke suite re-run green (annotation pointer behavior is
  explicitly not trusted from browser tests alone; see root `CLAUDE.md` and
  ADR 0006/0007).
- Commit `e5dbc6e`.
- Required checks: `npm run check`, `npm run build`, `npm run test:e2e`,
  `npm run test:native`.
