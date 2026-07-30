# Phase 5 Claude Code smoke — run 022

## Purpose

Run one normal Claude Code stream, then signal a second Claude process during
the controlled slow command and inspect the exact tool shell and child.

## Approved data and network use

The user approved two controlled Claude sessions using saved login and open
network. The approved data was the controlled prompts and temporary workspace
values. Admin-managed behavior that safe mode could not disable was also
allowed.

## Command

Run from `spikes/workspace-runtime/protocol`:

```sh
PYTHONPYCACHEPREFIX=/tmp/chive-sp2-pycache \
  python3 probe.py claude \
  --out transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.json
```

## Launch posture

- Claude Code: `2.1.218`
- Model: `claude-sonnet-4-6`
- Outer boundary: SP1 sidecar with `nolabs-ai/claude` and open network
- Saved login: available
- Inner Claude sandbox: disabled by the controlled settings file
- Claude customizations: safe mode
- MCP: strict empty config
- Tools: Bash only
- Session persistence: disabled
- Bare mode: disabled so saved-login access remained testable

## Evidence boundary

The retained result records the launch posture, exact shell and child PIDs, and
the checked parent/group relationships. It does not retain raw process command
lines or numeric PPID and PGID values.

## Normal turn

Claude started in the controlled workspace with bypass permission mode and the
exact tested model. Its JSONL stream contained init, partial stream, assistant,
Bash tool-use, tool-result, and successful result events.

Claude requested exactly:

```text
/bin/pwd && /bin/cat ./probe-marker.txt
```

The tool result and final reply contained the controlled workspace and
`CHIVE_SP2_MARKER`. The process exited 0. Raw prompts, model text, responses,
and stderr were not retained.

Normal turn result: **PASS.**

## Interrupted turn

Claude started the controlled slow shell and child. The probe confirmed both
exact PIDs, their unique run ID, parent relationship, and shared process group
before sending `TERM` to the supervised process group.

Claude exited with signal status `-15`. The controlled shell and child were
both gone at the first post-signal inspection. `KILL` was not sent, and
identity-checked fallback cleanup had no work to do.

Interrupted turn result: **PASS.**

## Final result

Phase 5: **PASS.** Claude Code provides the required one-shot JSONL stream and
tool execution. The tested outer process-group `TERM` path stopped Claude and
both controlled tool processes within the deadline.
