# ADR 0016: Sidebar Width Is JS State, Not Pure CSS

Status: Accepted

Date: 2026-07-09

## Context

Through ADR 0013, `.workspace`'s `grid-template-columns` was pure CSS:
three static rules (`.workspace`, `.workspace.has-right`,
`.workspace.no-left.has-right`) each using a fixed `minmax(...)` track for
the sidebar column. Making the sidebar user-resizable (drag a handle,
persist the chosen width) needed a per-user, per-session width value that
CSS alone can't hold.

## Decision

Sidebar width now lives in Svelte state (`sidebarWidths = $state<{ left,
right }>`), not in the CSS rules. `.workspace` gets its
`grid-template-columns` from an inline `style` attribute
(`workspaceColumns`, a `$derived`) computed from that state — `0` for a
closed side, the stored width in px for an open one. The three old static
CSS rules (`.workspace`, `.workspace.has-right`,
`.workspace.no-left.has-right`, previously each hand-listing a track) are
gone; the class list (`no-left`, `has-right`) still exists for the
dock/undock *transition*, but the actual track sizes come from state.

Width state lives in a new pure module,
`app/src/lib/ui/sidebar-resize.ts`: `clampSidebarWidth` (260–600px range,
default 367px), `resizedSidebarWidth` (pointer-delta → new width, sign
flipped per side since the left sidebar grows rightward and the right
sidebar grows leftward), and `serializeSidebarWidths`/`parseSidebarWidths`
for a `localStorage` round-trip (defensive against missing/malformed
stored JSON — falls back to defaults rather than throwing). This mirrors
`dock-state.ts`'s existing pattern of pure, unit-tested state logic with
the Svelte component only wiring pointer events to it.

The drag handle itself (`.sidebar-resizer`) is a `role="separator"` element
positioned on the sidebar's inner edge (mirrored per side, same pattern as
`.side-collapse`), using `pointerdown`/`pointermove`/`pointerup` — not
HTML5 drag-and-drop, consistent with ADR 0013 point 7's reasoning
(Playwright can't drive `DataTransfer`, WKWebView DnD is unreliable) even
though this is a resize, not a dock-drag.

## Why

CSS custom properties (`--sidebar-width: 367px`) were considered but
rejected: the resize handler needs to read the *current* width to compute
the next one (delta-based drag math), and Svelte state is the natural place
for a value the app also has to persist, clamp, and reason about elsewhere
(e.g. nothing else needed to read a CSS variable's live value). Driving the
grid from `$derived` state keeps one source of truth instead of state that
writes into computed CSS that then has to be read back out.

## Consequences

Good:
- Resize logic is pure and unit-tested independent of the DOM.
- Width persists across reload without extra plumbing beyond
  `localStorage`.

Bad:
- `.workspace`'s sizing is no longer fully visible by reading its CSS rule
  in isolation — the actual track sizes require checking
  `workspaceColumns`. Anyone changing sidebar layout behavior should search
  for `sidebarWidths`/`workspaceColumns` in `+page.svelte`, not just the
  `.workspace` CSS block.
- The `minmax(302px, 367px)` values baked into the CSS history (ADR-adjacent
  commits `f5804a1`/`a56e161`) are now only the *default*, not a hard
  design constraint — `SIDEBAR_MIN_WIDTH`/`SIDEBAR_MAX_WIDTH` in
  `sidebar-resize.ts` (260–600px) are the actual enforced range and were
  deliberately set wider than the old default range to give resizing room.

## Verification

- `app/tests/unit/sidebar-resize.test.ts` — clamp, delta math per side,
  serialize/parse round-trip, malformed-input fallback.
- `app/tests/e2e/ui-shell.spec.ts` — drag resizes and persists across
  reload, resize clamps at the minimum.
- Commit `e977dca`.
- Required checks: `npm run test:unit`, `npm run check`, `npm run build`,
  `npm run test:e2e`.
