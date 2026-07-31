# E7 — Codex runtime loss and outer cleanup boundaries

Status: **FAIL — no existing boundary stopped both tool processes**

Codex verdict: **VIABLE PROTOCOL / PRODUCTION BLOCKED**

Date: 2026-07-30

This experiment ran with inherited user configuration and open network access.
The user explicitly approved controlled prompts, the temporary workspace path,
inherited Codex context, and unknown inherited MCP startup traffic to configured
destinations for up to four sessions. Three sessions ran. No fourth session ran
because no existing boundary qualified as a final candidate.

## Commands

Run the model-free protocol tests from
`spikes/workspace-runtime/protocol` after adding the E7 process-tree and signal
checks:

```sh
python3 -B test_probe.py
```

Result: 20 tests passed.

Run E7:

```sh
python3 spikes/workspace-runtime/protocol/probe.py codex-lifecycle \
  --out spikes/workspace-runtime/protocol/transcripts/phase4-codex-interrupt-cleanup/e7-lifecycle.run-20260730-020.json
```

Each counted app-server child ran through the existing sidecar and nono:

```text
<SIDECAR_HARNESS> --nono /opt/homebrew/bin/nono \
  --profile nolabs-ai/codex --workspace-rw <WORKSPACE> --net open -- \
  <CODEX> app-server --stdio
```

## Operations shared by every attempt

Each attempt used a fresh temporary workspace and Codex connection:

1. Send `initialize`.
2. Start one ephemeral thread in the controlled workspace.
3. Start one turn that runs the controlled slow shell with a unique attempt id.
4. Wait for the command-start event and both exact PID files.
5. Resolve sidecar, nono, app-server, tool shell, and tool child through their
   parent lineage.
6. Record PID, parent PID, process group, session, and state.
7. Signal the selected boundary.
8. Inspect the same exact PIDs again.
9. Use identity-checked fallback cleanup for surviving controlled processes.

No prompt, model text, command output, command line, raw response, raw stderr,
configured MCP identity, endpoint, or credential was retained.

## Process topology

Every attempt observed the same structure:

- sidecar, nono, and app-server shared one process group;
- tool shell and tool child shared a different process group;
- the tool shell was initially a descendant of app-server;
- the tool child belonged to the tool shell;
- after the runtime boundary stopped, the tool shell was reparented to PID 1;
- the shell and child remained alive together in their separate group.

The app-server process group and outer sidecar process group were the same
group in all three attempts. They are separate concepts in the plan, but the
installed runtime stack collapses them to one signal target.

## Boundary results

| Attempt | Signal target | Runtime boundary stopped | Tool shell stopped | Tool child stopped |
| --- | --- | --- | --- | --- |
| App-server root | App-server PID with `TERM` | yes | **no** | **no** |
| App-server group | Resolved app-server group with `TERM` | yes | **no** | **no** |
| Outer sidecar group | Resolved sidecar group with `TERM` | yes | **no** | **no** |

No `KILL` escalation was sent because each selected PID or process group had
already disappeared after `TERM`. The surviving shell and child were in a
different process group, so signalling the original group again could not
reach them.

## Fallback cleanup

Every attempt required two identity-checked fallback actions: one for the tool
shell and one for the child. Inspection after fallback cleanup proved both were
gone each time. This prevents test leaks but is not credited to Codex, nono, or
the sidecar boundary.

## Candidate and verdict

None of the existing boundaries stopped both controlled processes. E7
therefore did not run a fourth candidate attempt and did not design a new
supervisor inside the spike.

The Codex protocol remains viable: E1–E6 established initialization,
per-thread control, streaming, same-thread turns, and protocol interruption.
Production cleanup is blocked because neither app-server loss nor the outer
sidecar process group owns tool processes that leave that group.

S4 needs a stronger process-tree lifecycle boundary that can discover and stop
descendants which create another process group or are reparented after their
runtime exits. That boundary must pass both normal and forced-stop tests before
the adapter is production-ready.

## Configuration and diagnostic observations

- Three Codex sessions ran with inherited user configuration.
- Each session observed 24 MCP startup-status events.
- The retained stderr line counts were 374, 374, and 375.
- Each session had one classified nono `--no-rollback` warning.
- Fallback cleanup left no controlled process running.

## Evidence

The matching machine-readable result is
`e7-lifecycle.run-20260730-020.json`. It keeps separate boundary checks,
before-and-after process relationships, fallback results, sanitized protocol
counts, and the final production verdict.
