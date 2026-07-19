# ADR 0014: Treat pdf.js's Bundled CSS as Unscoped and Adversarial

Status: Accepted

Date: 2026-07-09

## Context

`pdfjs-dist` ships `web/pdf_viewer.css`, and the app loads it (bundled into
`pdf.mjs`) because it's needed for text-layer and annotation-editor styling —
things this app genuinely uses. But that stylesheet also carries rules for
pdf.js's *own* reference-viewer UI chrome (its default sidebar, toolbar,
color-picker "doorhanger" popups, and so on) — UI this app never renders,
built with its own completely custom chrome instead (ADR 0013). Those rules
are not scoped, namespaced, or gated behind anything the app controls; they
apply globally to any element whose class matches, regardless of whether
that element has anything to do with pdf.js's viewer.

## Problem

**Class-name collision (`.sidebar`).** The app's own `.sidebar` grid
container — the `<aside>` holding the Outline/Bookmarks/Annotations dock —
collided with pdf_viewer.css's own `.sidebar` selector, used internally for
an unrelated color-picker doorhanger widget. That foreign rule set
`width: var(--sidebar-width)`, where `--sidebar-width` defaults to `239px`.
Svelte's style scoping gives the app's own `.sidebar` rule higher
specificity (`.sidebar.s-xxxxx` vs. plain `.sidebar`), but the app's rule
never set `width` explicitly — it relied on the CSS Grid item auto-stretch
default to fill its `.workspace` grid track. An unset property isn't a
specificity contest pdf.js's rule could lose; it's simply the only rule
setting `width` at all, so it won by default. The sidebar was silently
pinned to 239px regardless of what `.workspace`'s `grid-template-columns`
track specified — for as long as the collision went unnoticed, every width
change to the intended track was invisible, which read as "the sidebar is
fixed and can't be made wider" rather than as a bug.

**Broader-than-assumed interactivity (`.highlightEditor .internal`).**
Separately, the app has its own pointer-events override scheme for creation
mode (`.pdf-container.annotation-tool-active :global(...)`, in the
"Transplanted spike viewer CSS" block) that disables pointer events on
existing annotation editors so an armed tool's clicks reach the layer
instead of an existing editor. That scheme had per-kind exceptions for
free-text and ink (`.internal`, `.ink-hit-area polyline`) but not for
highlight — because pdf_viewer.css re-enables `pointer-events` on a
highlight editor's `.internal` element across its *entire rect* (unlike
free-text's tight text glyphs or ink's thin stroke hit-area), that
assumption silently failed for highlights specifically: clicks over an
existing highlight kept hitting the highlight editor instead of the armed
tool's own layer, and pdf.js's own creation path additionally requires the
event target to be the layer div itself to begin creating.

## Decision

1. Before adding any new top-level class name in `app/src/routes/+page.svelte`
   or component styles (`lib/ui/*.svelte`, `lib/pdf/*.svelte`), grep
   `node_modules/pdfjs-dist/build/pdf.mjs` for it (pdf_viewer.css is inlined
   into that bundle at build time, so this is the actual shipped surface,
   not just the source `.css` file). Prefer a name pdf.js doesn't use.
2. When renaming isn't practical (`.sidebar` itself is pinned by e2e specs
   per ADR 0013's DOM-contract rules), any app rule sharing a class name
   with a pdf.js rule must explicitly declare every layout-affecting
   property that rule could set (`width`, `position`, `display`, ...)
   instead of relying on browser/grid defaults — defaults are exactly where
   a same-or-lower-specificity foreign rule can win unnoticed. This is why
   `.sidebar-resizer` (the new drag handle) uses kebab-case rather than
   matching pdf.js's own camelCase `.sidebarResizer` — a name it uses inside
   its own colliding `.sidebar` rule.
3. When the app's own pointer-events override scheme needs to neutralize
   pdf.js's default interactivity for an existing annotation editor, verify
   each editor kind's DOM independently against pdf_viewer.css rather than
   assuming one kind's coverage generalizes to the others — highlight,
   free-text, and ink editors expose different interactive sub-elements.

## Why

pdf_viewer.css is a real, loaded stylesheet with real cascade weight — it is
not sandboxed just because the app doesn't render pdf.js's reference UI.
Svelte's scoping only protects against *this app's own* rules colliding with
each other; it does nothing against an external, unscoped stylesheet
asserting the same bare class name. The failure mode is quiet by
construction: nothing errors, the page renders, and the wrong value just
wins — which is why the `.sidebar` collision went unnoticed through however
many prior sessions touched that CSS, and only surfaced once someone tried
to change the value and got no visible effect.

## Consequences

Good:
- The sidebar-width bug (silently pinned to 239px) and the
  highlight-creation-blocked bug are both fixed and covered by tests.
- Future collisions are one `grep` away from being caught before shipping,
  once someone remembers to check.

Bad:
- This is a manual discipline, not an automated lint rule — nothing in
  `npm run check` catches a new colliding class name today.
- A `pdfjs-dist` version bump (load-bearing pin, see root `AGENTS.md`) could
  introduce new class names or change existing ones; a bump should include a
  pass over recently-added app class names against the new bundle.

## Verification

- `.sidebar { width: 100%; ... }` override — commit `a56e161`.
- `.sidebar-resizer` naming and the sidebar drag-resize feature — commit
  `e977dca`.
- `.pdf-container.annotation-tool-active :global(.annotationEditorLayer
  .highlightEditor :not(.editToolbar, .editToolbar *))` override — commit
  `e5dbc6e`, exercised by `tests/e2e/annotation-lifecycle.spec.ts`'s "ink
  tool draws a new stroke starting inside an existing highlight region" and
  "free text tool creates inside an existing highlight region".
- Required checks for related changes: `npm run check`, `npm run build`,
  `npm run test:e2e`, `npm run test:native`.
