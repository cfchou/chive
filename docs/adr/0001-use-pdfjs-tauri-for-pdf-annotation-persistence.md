# ADR 0001: Use PDF.js in a Tauri App for PDF Annotation Persistence

Status: Accepted

Date: 2026-06-25

## Context

We want a desktop PDF reader with editable annotations. The P0 question for the spike was narrow:

Can the app create annotations, save them into the PDF file itself, reopen them, and have other PDF readers see them?

This matters because annotations must be portable. A user should not lose highlights, free-text notes, or ink if they open the file in Preview, PDF Expert, Acrobat, or another app.

## Terms

- PDF.js: Mozilla's JavaScript PDF renderer and editor. It can draw PDF pages in the browser and has annotation editor support.
- Tauri: Desktop app shell. It lets a web UI run as a native macOS app and lets TypeScript call Rust commands for local file access.
- SvelteKit: Frontend framework used for the app UI.
- Annotation persistence: saving annotations inside the PDF bytes, not in a separate sidecar file.
- External reader: any PDF reader outside this app, such as Preview or PDF Expert.

## Problem

The hard part is not drawing UI on top of a PDF page. The hard part is saving real PDF annotations back into the PDF in a way other readers understand.

A custom overlay would be easy to build, but it would not be portable unless we later wrote our own PDF annotation writer. That would be risky and large in scope.

## Decision

Use PDF.js as the PDF renderer and annotation writer. Use Tauri only for native desktop concerns:

- open a local PDF
- read bytes from disk
- write saved bytes back atomically
- package the web UI as a macOS app

The app calls `pdfDocument.saveDocument()` after PDF.js creates or edits annotations. Tauri then writes the returned PDF bytes to disk.

## Why

This keeps the most PDF-specific work inside PDF.js. PDF.js already knows how to serialize supported annotation editor data into the PDF.

It also matches the user's implementation strengths:

- TypeScript/JavaScript for PDF.js and UI
- Rust for native file IO through Tauri
- no Swift required

## Alternatives Considered

Use native Apple PDFKit:

- Better macOS-native integration.
- Requires Swift/AppKit knowledge.
- Portability to non-macOS platforms becomes worse.
- Not aligned with current skill set.

Use a commercial PDF SDK:

- Likely strongest editing support.
- Adds license cost and vendor lock-in.
- Less useful for a spike whose goal is understanding feasibility.

Write custom PDF annotation serialization:

- Maximum control.
- High risk. PDF annotation writing is format-heavy and easy to corrupt.
- Too much scope for P0.

Use sidecar files:

- Easy for AI metadata or app-only state.
- Not acceptable for P0 annotation persistence because annotations must travel with the PDF.

## Consequences

Good:

- Highlight, free-text, ink, and marker-style ink can persist in the PDF.
- Saved files can be opened by external PDF readers.
- Implementation remains mostly TypeScript plus small Rust file commands.

Bad:

- We depend on PDF.js annotation editor behavior.
- Some APIs used by the spike are not high-level product APIs.
- PDF.js upgrades can break editor lifecycle or DOM assumptions.

## Verification

The spike confirmed:

- highlight selection persists
- highlight tool annotations can be edited, recolored, deleted, saved, and reopened
- free-text can be edited, recolored, moved, deleted, saved, and reopened
- ink can be recolored, thickness-edited, moved, deleted, saved, and reopened
- saved PDFs remain readable by external PDF readers

The regression harness now covers these flows without manual testing.

