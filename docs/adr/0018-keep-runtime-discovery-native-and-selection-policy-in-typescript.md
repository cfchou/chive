# ADR 0018: Keep Runtime Discovery Native and Selection Policy in TypeScript

Status: Accepted

Date: 2026-07-19

## Context

Issue #31 adds discovery for installed Codex, OpenCode, and Claude Code
executables. Chive must find them when launched as a macOS GUI app, where the
inherited `PATH` can be smaller than the user's shell `PATH`. It must also let
the user choose a runtime or provide an executable path without storing
credentials or silently changing an explicit choice.

This work contains two different kinds of knowledge:

- OS facts: filesystem metadata, executable permissions, known install
  locations, process spawning, deadlines, bounded output, and path redaction.
- Product policy: built-in runtime priority, Runtime Override and Executable
  Override behavior, draft settings, Save/Cancel, and user-facing status.

An executable path is untrusted input. A version command can hang, write a lot
of output, fail, or leave a descendant holding its output pipe open. Discovery
therefore needs process-lifecycle rules that are stronger than a normal
frontend command invocation.

## Decision

### Rust owns OS discovery and probing

`app/src-tauri/src/runtime_discovery.rs` is a deep native module. Its external
interface is one request and one report, exposed through the
`discover_runtimes` Tauri command:

- The request contains at most one Executable Override.
- The report contains one readiness result for each supported runtime.
- Per-runtime failures are report data. The Tauri command rejects only when
  the blocking discovery task itself cannot complete.

The Rust implementation privately owns candidate construction and order,
filesystem validation, direct `--version` execution, child and per-runtime
deadlines, kill/reap behavior, bounded output capture, and display-path
redaction. It launches the executable directly rather than through a shell.
The command runs the synchronous scan on Tauri's blocking pool so a slow local
process does not block the WebView thread.

The exact known-location list is implementation policy, not part of this ADR.
It can change as installation conventions change while the request/report
interface stays stable.

### TypeScript owns validation and product selection

`app/src/lib/settings/runtime-discovery.ts` treats the Tauri result as
`unknown`, validates the whole report, and normalizes it into Chive's built-in
priority order. It owns the pure rule that resolves a selected runtime from
Application Settings and the latest report.

The `RuntimeDiscovery` interface has one operation, `scan`. The native Tauri
adapter and deterministic in-memory adapter both satisfy it. Browser tests can
therefore exercise the same selection and Settings behavior without pretending
to discover OS executables in JavaScript.

Rust does not choose the selected runtime, persist Application Settings, or
handle authentication. TypeScript does not search the filesystem or launch
runtime executables.

### The Runtime Settings session owns draft and committed state

`app/src/lib/settings/runtime-settings-session.svelte.ts` owns the stateful
workflow between persistence, discovery, and the Application Settings Modal.
Committed settings and their report stay separate from the open modal's draft
settings and report. Request IDs stop late scans from replacing newer state,
and report provenance lets Save reuse a matching report instead of scanning
again. A required post-Save scan runs in the background after persistence
succeeds.

The Svelte section receives plain state and sends semantic draft actions. It
does not call Tauri or the settings repository directly.

### Readiness means executable readiness only

A ready runtime has an executable that passed the bounded version probe. It
does not mean that the runtime is authenticated, compatible with a future chat
adapter, or ready for a conversation. Those concerns belong to later runtime
adapter work.

## Why

- Rust has the native process and filesystem tools needed to handle local
  executables safely and consistently.
- TypeScript is the right place for app policy that drives Svelte UI and must
  be testable with an in-memory adapter.
- The small request/report and `scan` interfaces hide platform details from
  callers while keeping both sides independently testable.
- Keeping failures as data lets Settings show and correct an invalid override
  instead of losing the whole discovery report.

## Rejected Alternatives

### Discover runtimes in browser TypeScript

The SvelteKit app runs in a WebView without Node.js process or filesystem
access. Recreating native discovery through several small Tauri commands would
leak candidate and process-lifecycle details across the seam.

### Use only the inherited `PATH`

This misses common installations when Chive starts from Finder or the Dock.
Known-location discovery is required to cover the macOS GUI `PATH` gap.

### Run version checks through a shell

A shell would add quoting and injection risk for a user-provided Executable
Override. Direct process execution treats the path as a path, not command text.

### Put runtime selection in Rust

Selection is Application Settings policy, not an OS fact. Moving it into Rust
would make browser and UI tests depend on the native bridge and would mix
persistence/UI rules into the discovery module.

## Consequences

Good:

- Native discovery complexity stays behind one request/report interface.
- Selection and Settings transitions stay deterministic and testable without
  installed runtimes.
- A hanging or noisy executable is bounded, killed, reaped, and cannot expose
  raw child output in the report.
- Browser and native adapters exercise the same TypeScript policy.

Trade-offs:

- Adding a supported runtime requires coordinated Rust serialization and
  TypeScript validation/UI changes.
- Known install locations need maintenance as runtime installers evolve.
- Rust tests cover OS behavior; browser tests alone cannot establish that
  native discovery works in WKWebView/Tauri.
- A scan can still take several seconds, so callers must treat it as
  asynchronous and must not hold Save open while refreshing a committed
  report.

## Verification

- `app/src-tauri/src/runtime_discovery.rs` tests candidate order, overrides,
  direct probes, timeout/kill/reap, aggregate budgets, bounded output, and
  redaction.
- `app/tests/unit/runtime-discovery.test.ts` tests report validation,
  normalization, selection, and the in-memory adapter.
- `app/tests/unit/runtime-settings-session.test.ts` tests draft/committed
  transitions, races, Save behavior, and report reuse.
- `app/tests/e2e/application-settings.spec.ts` tests the browser-visible
  Settings behavior.
- `app/tests/native/native-smoke.spec.ts` probes a temporary executable through
  the real Tauri command and WKWebView UI.
