# ADR 0011: Use Native PDF Outline Colors

Status: Proposed

Date: 2026-07-04

## Context

The PDF annotation spike supports a navigation sidebar with Document Outline Entries and Chive Bookmarks.

Readers need a way to color-code those entries and keep the colors after saving and reopening the PDF.

The PDF outline item dictionary already has standard fields for this:

- `/C`: outline item text color as RGB components in the range `0.0` to `1.0`
- `/F`: outline item style flags such as italic and bold

PDF.js exposes outline color for display through `getOutline()`. In the current dependency, the outline node type includes `color: Uint8ClampedArray`, `bold`, and `italic`.

This means Chive can use the PDF's native outline color field instead of inventing app-local metadata.

## Decision

Use native PDF outline item `/C` for outline and Chive Bookmark color persistence.

Do not use:

- XMP metadata
- app-local metadata
- hidden sidecar state
- custom color schemas

Use a fixed palette:

- default
- red
- orange
- yellow
- green
- blue
- purple

Default means "remove `/C` when the user explicitly chooses Default." It does not mean "write black."

## Terms

- Document Outline Entry: an outline item that came from the opened PDF and is not under Chive's bookmark root.
- Chive Bookmark: a user-created bookmark stored under the `My Bookmarks` outline group.
- Native outline color: PDF outline item `/C`.
- Imported outline patch: an incremental PDF update that rewrites only `/C` for existing document outline item dictionaries.
- Capability gate: a strict check that Chive can locate and safely rewrite the exact outline objects before enabling color editing.

## User Experience

For Document Outline Entries:

- normal state shows a small left color accent
- hover and focus states reveal a compact color button
- the color button opens the fixed palette
- choosing a color updates the Outline Sidebar Entry immediately and marks the PDF dirty

For Bookmark Sidebar Entries:

- normal state uses the Chive Bookmark color for the bookmark icon and page-rail marker
- edit state shows title input plus a visible color chip
- the chip opens the same fixed palette
- choosing a color updates the Bookmark Sidebar Entry immediately and marks the PDF dirty

Keyboard labels must name the target and color, for example:

- `Set outline color red`
- `Set Chive Bookmark color default`

## Data Model

Extend the PDF.js raw outline shape with:

- `color?: Uint8ClampedArray | number[]`
- `bold?: boolean`
- `italic?: boolean`

Extend normalized document outline entries with:

- `color: string | null`
- `originalColor: string | null`
- `nativeObjectNumber: number | null`
- `colorDirty: boolean`

Extend Chive Bookmark entries with:

- `color: string | null`

Normalize PDF.js RGB bytes to lower-case hex, for example:

```ts
[240, 68, 68] -> "#f04444"
```

Display black `[0, 0, 0]` as default unless there is a later product reason to expose explicit black. Preserve the difference internally with `originalColor` and `colorDirty` so a save without user color edits does not rewrite or delete explicit source data.

## Read Path

When loading a PDF:

1. Call `pdfDocument.getOutline()`.
2. Read `item.color` from each outline node.
3. Normalize colors into the fixed palette when possible.
4. Preserve non-palette native colors as display-only accents unless custom colors are deliberately added later.
5. Split Chive Bookmarks from Document Outline Entries using the `My Bookmarks` root.
6. Render Document Outline Entry colors and Chive Bookmark colors from the normalized entries.

The read path should work even when write capability is unavailable. A PDF can display existing outline colors without allowing recolor.

## Write Path

Saving follows this order:

1. Call `pdfDocument.saveDocument()` to let PDF.js persist annotation/editor changes.
2. Remove any prior Chive Bookmark outline group.
3. Apply imported document-outline color patches only for dirty outline entries.
4. Append the current Chive Bookmark outline group, including `/C` for colored Chive Bookmarks.
5. Write the final bytes through the existing atomic Tauri save command.

For Chive Bookmarks:

- write `/C [r g b]` on generated Chive Bookmark outline item dictionaries when `color` is non-null
- omit `/C` when `color` is null
- keep the generated outline structure otherwise unchanged

For imported document outline entries:

- use an incremental update
- rewrite only the target outline item dictionary
- add, replace, or remove `/C`
- do not touch `/Title`, `/Dest`, `/A`, `/First`, `/Last`, `/Prev`, `/Next`, `/Parent`, `/Count`, or `/F`

## Imported Outline Capability Gate

Imported outline color editing is enabled only when Chive can safely map UI entries to PDF outline item objects.

The first implementation may use strict support:

1. Locate `/Catalog`.
2. Locate `/Outlines`.
3. Traverse `/First` and `/Next` outline item links depth-first.
4. Read only plain indirect objects that can be found in the saved PDF bytes.
5. Match traversal order with PDF.js `getOutline()` order.
6. Store the object number on each normalized outline entry.

Disable imported outline recolor when any required condition fails.

Examples of unsupported structures:

- encrypted PDFs
- signed PDFs
- outline items in object streams that the patcher cannot safely rewrite
- unsupported xref structure for the current patcher
- outline objects with nonzero generations if the patcher only supports generation `0`
- traversal count mismatch between PDF bytes and PDF.js outline output
- malformed outline links

When disabled, Chive should still display existing colors and show a clear status such as:

`Outline color editing unavailable for this PDF structure.`

## Why

Native `/C` is the PDF-standard location for outline color. It keeps saved files self-contained and avoids Chive-only state that other PDF tools cannot understand.

A fixed palette keeps output predictable, testable, and accessible. It also avoids support cost around arbitrary hex color entry and contrast issues.

Default-as-removal keeps generated PDF output clean. It avoids writing `/C [0 0 0]` for normal entries.

The strict capability gate is necessary because arbitrary PDF object rewriting is risky. The current spike already uses incremental string-based dictionary updates for generated Chive Bookmark outlines. That pattern is acceptable for controlled objects but must be conservative for imported outline objects from arbitrary PDFs.

## Consequences

Good:

- colored outline entries survive save and reopen
- Chive-created bookmarks use the same native PDF mechanism
- no XMP or app-local metadata
- existing colored PDFs can display their colors
- unsupported PDFs fail read/write capability gracefully instead of being corrupted

Bad:

- imported outline recolor is not available for every PDF at first
- object mapping adds parser complexity
- browser tests alone cannot prove native PDF.js behavior
- external-reader compatibility is best-effort unless tested manually or added later

## Out of Scope

This ADR does not include:

- custom hex colors
- outline rename, reorder, add, or delete
- editing `/F` bold or italic
- XMP synchronization
- app-local metadata fallback
- full external-reader compatibility automation

## Verification

Required checks for the initial implementation:

- `npm run check`
- `npm run build`
- targeted Playwright coverage for outline and Chive Bookmark colors
- existing navigation/Chive Bookmark regression coverage

Critical behavior should also be covered by native smoke or regression because PDF.js behavior can diverge between browser automation and Tauri WKWebView.

Test cases:

- fixture PDF with default, red, blue, and green outline entries displays expected colors
- imported outline entry recolor saves and persists after reopen
- imported outline save without user color edits preserves existing colors
- unsupported imported outline structure displays colors but disables recolor
- Chive Bookmark color can be changed while editing title
- Chive Bookmark color appears on bookmark icon and page-rail marker
- Chive Bookmark color persists after save and reopen
- selecting Default removes `/C` for dirty entries instead of writing black
- byte-level saved PDF assertion contains expected `/C [r g b]` entries

## Relation to Other ADRs

ADR 0005 explains why persisted sidebar data should be derived from PDF geometry and durable PDF state.

ADR 0006 and ADR 0007 explain why browser tests are not enough for PDF.js behavior in the native Tauri WKWebView.

ADR 0011 extends that same rule to outline and Chive Bookmark colors: PDF bytes are the durable source, and native verification remains part of critical behavior changes.
