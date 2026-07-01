# ADR 0008: Draft LLM-Generated Speculative Test Coverage for Human Curation

Status: Proposed

Date: 2026-06-27

## Context

Regression testing for the PDF spike needs broader behavior coverage than the current canonical suites can practically hold from first principles.

LLMs can quickly propose a large set of edge-case scenarios, but raw output is not directly reliable as test code.

We need a process that turns speculative ideas into stable, maintainable, canonical tests.

## Problem

When scenarios are only manually thought through:

- coverage gaps are missed,
- creative combinations are difficult to enumerate,
- exploratory bug reports are not consistently converted into regression specs.

When every LLM suggestion is accepted unreviewed:

- tests become noisy,
- flakes increase,
- suite meaning degrades,
- onboarding burden rises.

## Decision

Introduce a separate `LLM Speculative Coverage` process with explicit curation gates, and keep it out of canonical test ownership until approved.

The flow is:

- `generate`: LLM creates candidate scenarios,
- `triage`: owner reviews for value and risk,
- `canonicize`: only approved cases are added to Playwright or WDIO.

This ADR covers drafting only and does not make every generated idea a required test.

## Terms

- **Speculative scenario**: An LLM-suggested test idea, not yet required for CI.
- **Curation board**: A short list of accepted/rejected candidates with reasons.
- **Canonicized test**: A reviewed scenario implemented in the canonical suite.

## Process

### 1) Spec Generation

Use an LLM prompt to generate:

- scenario intent,
- preconditions,
- steps,
- expected result,
- fixture type (`text`, `scanned`, `outline`, `edge`).

### 2) Triage and Safety Filter

Each candidate is scored 1–5 for:

- **Relevance**: directly affects user-critical paths,
- **Reproducibility**: deterministic across runs,
- **Coverage gain**: fills a gap,
- **Feasibility**: implementable with existing test layers.

Only scenarios with clear score and low flake risk move forward.

### 3) Canonicalization

Promote only scenarios that:

- are not duplicate of existing Playwright/WDIO coverage,
- are stable in manual reproduction,
- have deterministic assertions,
- can be automated by one command.

Promoted scenarios become:

- Playwright spec (browser layer), or
- WDIO Tauri spec (native-only failure path).

### 4) Archival

Keep unpromoted speculative scenarios in a short `speculative-coverage` list with reason (`duplicate`, `flaky`, `low value`, `not reproducible`).

This preserves discoverability without CI churn.

## Why Not Add These Directly

Direct acceptance of speculative cases would shift the suite from signal to volume.

This process preserves the benefit of broad scenario brainstorming while protecting suite reliability.

## Consequences

Good:

- broader idea space from LLM suggestion,
- controlled growth of canonical test suite,
- fewer duplicate or brittle tests.

Bad:

- adds triage overhead,
- requires a short curation record,
- delayed adoption for low-priority scenarios.

## Implementation in This Repository

Add this as a lightweight document-driven workflow:

1. Keep exploratory generation in an internal document (or issue notes).
2. Add a short curation section in regression planning notes.
3. Implement only curated, deterministic cases as Playwright or WDIO tests.
4. Optionally track rejected candidates with one-line rationale.

## Relation to ADR 0007

ADR 0007 owns the permanent browser/native layer split.

ADR 0008 owns how speculative LLM ideas are converted into canonical tests.
