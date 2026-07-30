# Phase 1 — controlled workspace files

- Run id: `run-20260727-007`
- Status: **PASS**
- Working directory: `<CHIVE_ROOT>`
- Expected: `prepare_workspace()` copies exactly the three controlled files and
  removes the temporary workspace afterward.

## Operator command

```sh
python3 -B spikes/workspace-runtime/protocol/test_probe.py \
  WorkspaceFixtureTests.test_prepare_workspace_copies_only_the_controlled_files
```

## Observed

The temporary workspace contained exactly:

```text
probe-marker.txt
slow-command.sh
claude-settings.json
```

- Marker content: `CHIVE_SP2_MARKER`
- Claude sandbox setting: `enabled=false`
- Slow command: readable
- Unrelated files copied: none
- Temporary workspace removed after use: yes
- Focused test exit code: `0`

The script does not need an executable bit because every planned launch invokes
it through `/bin/sh`. No `prepare_workspace()` implementation change was
needed.

No model or network connection was used.

Machine-readable evidence:
[`workspace-fixtures.run-20260727-007.json`](workspace-fixtures.run-20260727-007.json)
