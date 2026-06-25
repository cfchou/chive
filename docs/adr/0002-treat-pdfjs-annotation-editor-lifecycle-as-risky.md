# ADR 0002: Treat PDF.js Annotation Editor Lifecycle as Risky and Test It Directly

Status: Accepted

Date: 2026-06-25

## Context

PDF.js has annotation editor modes:

- highlight
- free-text
- ink

The app needs users to create annotations, click existing annotations, edit them, save them, reopen them, and continue editing.

This sounds simple, but editor lifecycle is the hardest part of the spike.

## Problem

PDF.js annotation editing is stateful. An annotation can exist in several states:

- being created from selected text
- live in the current editor layer
- selected for editing
- serialized into the in-memory PDF
- reopened from saved PDF bytes
- deleted from annotation storage

These states do not always behave the same.

During the spike, highlights created through `Highlight Selection` exposed this problem. A newly created highlight looked correct but could fail to enter edit mode when clicked. The same highlight often became editable after saving and reopening.

That means visual confirmation alone is not enough. We need lifecycle tests.

## Decision

Treat PDF.js editor lifecycle as a first-class risk. Keep a regression harness that exercises real lifecycle transitions:

- create
- select by real click
- edit
- recolor
- move where supported
- delete
- save
- reopen
- verify with PDF.js annotation data

The app may use PDF.js editor internals for the spike, but every such usage must be covered by regression tests.

## Implementation Notes

The spike uses PDF.js concepts that are not beginner-friendly:

- `PDFViewer` renders the document.
- `annotationEditorMode` changes the current tool.
- `annotationEditorUIManager` tracks selected editors and editor parameters.
- PDF.js editor DOM classes such as `.highlightEditor`, `.freeTextEditor`, and `.inkEditor` are used by the harness to click real rendered annotations.

This is acceptable for a spike because the goal is to prove feasibility. For product code, these assumptions should be isolated behind a small adapter module.

## Specific Difficulties

Highlight:

- Text selection can disappear when a toolbar button is clicked.
- We had to remember selected text ranges before running `highlightSelection()`.
- Freshly created highlights needed extra selection handling so they could be clicked and edited before save/reopen.

Free-text:

- Free-text annotations can show popup-like UI if not controlled.
- Tests need to verify text content after save/reopen, not just DOM presence.
- Move persistence must be checked through annotation rectangles after reopen.

Ink:

- Ink is created by pointer sessions, not by a simple function call.
- Tests must dispatch pointer down/move/up against the annotation editor layer.
- PDF.js only commits some ink drawing state when the drawing session ends or the tool mode changes.
- Cursor hotspot had to be adjusted so the stroke follows the pencil tip visually.

## Consequences

Good:

- We can catch regressions without asking a human to repeat long manual flows.
- Known fragile spots are documented and tested.
- PDF.js upgrades become safer because tests will catch editor lifecycle changes.

Bad:

- The harness knows about PDF.js DOM structure.
- Tests are more like product integration tests than small unit tests.
- If PDF.js changes class names or editor behavior, the harness may need updates.

## Verification

The current harness covers:

- highlight selection create/recolor/delete/save/reopen
- highlight tool create/recolor/delete/save/reopen
- free-text create/edit/recolor/move/delete/save/reopen
- ink create/recolor/thickness/move/delete/save/reopen
- marker-style ink persistence

