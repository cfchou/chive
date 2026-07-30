# Phase 6 OpenCode smoke — run 023

## Purpose

Run one normal OpenCode JSON turn, then start a second session through the
local OpenCode server, observe its controlled slow Bash tool while it is
running, abort that session, and inspect the exact tool shell and child.

## Approved data and network use

The user approved two controlled prompts, the temporary workspace path,
marker, run ID, and inherited OpenCode context being sent over open network
using saved credentials. The user also allowed integrations not disabled by
`--pure` to contact their configured endpoints with their configured
credentials and startup payloads.

## Command

Run from `spikes/workspace-runtime/protocol`:

```sh
PYTHONPYCACHEPREFIX=/tmp/chive-sp2-pycache \
  python3 probe.py opencode \
  --out transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.json
```

## Launch posture

- OpenCode: pinned `1.18.4` binary with the Phase 0 SHA-256
- Model: `github-copilot/gpt-5.6-terra`
- Outer boundary: SP1 sidecar with `opencode-0723a` and open network
- Saved credentials: available
- OpenCode plugins: `--pure` disabled external plugins
- Tool approval: `--auto`
- Inner OS sandbox: none around the OpenCode shell tool
- Configuration: inherited except for behavior disabled by `--pure`

## Evidence boundary

The retained result records the launch posture, exact shell and child PIDs, and
the checked parent/group relationships. It does not retain raw process command
lines or numeric PPID and PGID values.

## Normal turn

`opencode run --format json` emitted valid step-start, completed Bash tool,
step-finish, and assistant-text records. The controlled Bash command completed
with the temporary workspace and `CHIVE_SP2_MARKER`, and OpenCode exited 0.

The one-shot stream did not emit a separate live tool-start record. That
matches the tested 1.18.4 interface, so the second session used the local
server event stream for the live-start check.

Normal turn result: **PASS.**

## Interrupted server session

The probe started `opencode serve` on loopback, created one test session, and
observed the controlled Bash part in its `running` state over the SSE stream.
It confirmed the exact shell and child PIDs, their parent relationship, and
their shared process group before calling:

```text
POST /session/:sessionID/abort
```

The abort returned success. Both controlled processes were gone at the first
post-abort inspection, so fallback cleanup performed zero actions. The session
was no longer busy, the test session was deleted, and the local server stopped.

Interrupted session result: **PASS.**

## Final result

Phase 6: **PASS.** OpenCode provides the required structured one-shot stream,
live server event, session abort, and controlled tool-process cleanup for this
smoke depth. The run did not test later-turn reuse, multiple runtime-stop
boundaries, or a forced-`KILL` path.
