# ADR 0004: Use a Browser Regression Harness for PDF Spike Validation

Status: Superseded by ADR 0007

Date: 2026-06-25

## Context

Manual testing became too slow and unreliable. The user had to repeatedly:

- select text
- click highlight buttons
- save
- reopen
- inspect whether annotations could be clicked or edited
- report what happened

This is bad for a spike because the same bug can reappear after each change.

## Problem

The app has two runtime environments:

- Tauri desktop app, which can read and write local files through Rust commands.
- Browser dev app, which cannot freely read arbitrary local files.

The regression harness runs against the browser dev app because browser automation is faster and easier to script. But we still need to load arbitrary PDF files from `tmp/`.

Also, simple assertions are not enough:

- Annotation counts can pass while page rendering is broken.
- A created annotation can exist but fail to be editable.
- Scanned PDFs do not have selectable text, so highlight tests must not assume text exists.

## Decision

Use a browser regression harness that drives the app like a user and calls a small debug API exposed by the app in development.

This ADR was later superseded by ADR 0007: Playwright is now the repository-owned browser regression harness, and WDIO Tauri owns native WKWebView smoke coverage.

External PDF probes should be added as explicit Playwright fixtures when they are worth keeping as regressions. One-off exploration can still be done manually outside the repository test suite.

For saved PDFs in browser mode, the app uses an in-memory debug file store. This allows save/reopen flows without Tauri filesystem access.

## What the Harness Tests

Always:

- open PDF
- verify first page canvas has real visible content
- zoom in/out/fit width
- switch tools
- free-text create/edit/recolor/move/delete/save/reopen
- ink create/recolor/thickness/move/delete/save/reopen
- marker-style ink save/reopen
- check browser page errors

Only when selectable text exists:

- highlight selection create/recolor/delete/save/reopen
- multiple live highlights remain independently editable
- highlight tool create/recolor/delete/save/reopen

For scanned/image PDFs:

- highlight tests are skipped because no text selection exists
- free-text and ink tests still run

## Why Not Only Unit Tests

Unit tests would miss the risky parts:

- browser selection behavior
- pointer events for ink
- PDF.js editor DOM behavior
- save/reopen state changes
- scanned PDF rendering

The risk is integration behavior, so the tests must be integration tests.

## Consequences

Good:

- No human loop required for persistence regression.
- Works with multiple PDFs in one command.
- Catches page rendering failures, not only annotation data failures.
- Makes PDF.js upgrade risk visible.

Bad:

- Harness depends on local dev server and browser automation.
- Some test helpers know about PDF.js DOM structure.
- The debug API is spike-only and should be kept isolated from product behavior.

## Current Run

```bash
npm run test:e2e
npm run test:native
```
