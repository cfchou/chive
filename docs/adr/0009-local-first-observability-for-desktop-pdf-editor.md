# ADR 0009: Use Local-First Observability for the Desktop PDF Editor

Status: Proposed

Date: 2026-06-28

## Context

This app is a local-first Tauri desktop PDF editor that handles user documents on-device through `read_pdf` and `write_pdf_atomic` commands.

User data can include local file paths, PDF contents, extracted text, and annotations. We currently have minimal runtime visibility: local logs are the only explicit operational signal in the app.

The team asked whether tracing, metrics, or profiling are needed in addition to logging.

## Problem

For this class of app, three competing pressures are common:

- Need to debug runtime issues across browser and native WebView paths.
- Avoid over-collecting sensitive user-document context.
- Keep maintenance low for a small app with no dedicated backend.

Adopting a full cloud-native observability stack would be overkill now and could create privacy friction.

## Decision

Adopt a **local-first observability baseline** and defer fleet observability until a backend/service layer is introduced.

1. **Keep structured logging as the baseline signal** (always-on, local).
2. Add **lightweight local tracing** (span/timing) for critical user flows.
3. Keep **metrics opt-in and limited** to aggregated, non-sensitive runtime health indicators.
4. Treat profiling as **explicit/dev-only tooling**, not a resident telemetry service.
5. Add **optional hosted crash/error reporting only later** when we need user-reported crash clustering and we have a clear policy for redaction.

## Observability Coverage in This ADR

### 1) Logging (Baseline)

- Rust/Tauri: add structured logs around filesystem command boundaries and failure modes.
- Frontend: capture key interaction and lifecycle exceptions into the local log sink.
- Log entries should include severity, component, correlation ID where possible, and sanitized error context.
- Add a local export mechanism so users can send logs for support.

### 2) Tracing (Local Timing)

- Implement per-flow timing around the following operations:
  - `open_pdf`
  - `read_pdf`
  - `pdfjs_load_document`
  - `render_first_page`
  - `extract_outline`
  - `extract_annotations`
  - `save_pdf`
  - `write_pdf_atomic`
- Represent trace data as structured JSON log records (no distributed tracing backend required initially).

### 3) Metrics (Small, Optional)

Use only if requested by product/reliability needs and only after privacy review.

- Allowed (aggregate only): event counts, operation durations, failure rates, fallback usage.
- Prohibited by default: document identifiers, filenames, full paths, annotation text, extracted text, and document content.
- Export for analytics only through an explicit user action.

### 4) Profiling (On-Demand)

- No always-on profiler in release runtime.
- Use browser devtools / platform tools during investigations.
- Keep a hidden/instrumented debug mode for deep CPU/memory traces if a reproducible performance bug is found.

## Why Not Full Cloud Observability Now

OpenTelemetry collectors, Prometheus, and managed SaaS dashboards should be introduced only if the app evolves to include:

- Multi-user back-end services,
- sync/remote processing,
- central support requirements beyond local diagnostics,
- sustained production operations across many machine profiles.

Until then, these add complexity and privacy overhead with little incremental value.

## Privacy Rules

To keep this app safe for local documents:

- Never log or export file contents.
- Never log annotation text.
- Never log extracted full-text values.
- Never emit full paths by default in remote payloads.
- Keep local logs under user control and avoid automatic remote upload.

## Consequences

Good:

- Faster debugging on real user repros without adding external infra.
- Lower risk of accidental document/data leakage.
- Signals available before and during support flows.

Bad:

- Less fleet-wide error clustering than hosted error platforms.
- Correlation across many machines is limited without a backend.

## Implementation Notes for This Repo

When implementing, start with the existing local log/trace path and keep it additive:

1. Add local structured logs around `src-tauri/src/lib.rs` command paths.
2. Add frontend exception/timing markers around document open/render/save lifecycle.
3. Add a deterministic log export artifact for support tickets.
4. Keep this ADR alive as the policy boundary for any future telemetry additions.
