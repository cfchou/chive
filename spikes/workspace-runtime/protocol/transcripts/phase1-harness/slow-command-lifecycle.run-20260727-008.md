# Phase 1 — slow command lifecycle

- Run id: `run-20260727-008`
- Status: **PASS**
- Working directory: `<CHIVE_ROOT>`
- Expected: the controlled shell and sleep child are uniquely identifiable,
  stay in one process group, and both disappear when the shell receives TERM.

## Operator commands

The focused red and green checks used:

```sh
python3 -B spikes/workspace-runtime/protocol/test_probe.py \
  SlowCommandFixtureTests.test_term_stops_and_reaps_the_identified_shell_and_child
```

Shell syntax and the final Phase 1 suite used:

```sh
sh -n spikes/workspace-runtime/protocol/fixtures/workspace/slow-command.sh
python3 -B spikes/workspace-runtime/protocol/test_probe.py
```

The lifecycle runs used normal host process inspection because the managed
Codex sandbox does not permit `/bin/ps`.

## Controlled argv

```text
["/bin/sh", "./slow-command.sh", "run-20260727-008"]
["./.slow-child-run-20260727-008", "300"]
```

The second command is a temporary symlink to `/bin/sleep`.

## Red

Both PID files were written and both processes were alive, but the child command
was only `/bin/sleep 300`. It did not contain `run-20260727-008`, so the identity
assertion failed. The focused test exited with code 1.

## Change

- The fixture creates a temporary sleep symlink whose name contains the run ID.
- The child command therefore carries the same unique ID as its PID filename.
- An EXIT trap removes the temporary symlink on normal and signalled exits.
- Fallback cleanup recognizes this controlled child name and still requires the
  exact run ID before signalling it.

## Green

- Parent and child PID files written: yes
- Parent PID matched the started shell: yes
- Child symlink target: `/bin/sleep`
- Parent and child alive before TERM: yes
- Run ID in both live process commands: yes
- Same process group and session: yes
- Parent exit after TERM: `143`
- Parent and child absent afterward: yes
- Zombie left behind: no
- Temporary child symlink removed: yes
- Shell syntax check: pass
- Final Phase 1 result: 7 tests passed

No model or network connection was used.

Machine-readable evidence:
[`slow-command-lifecycle.run-20260727-008.json`](slow-command-lifecycle.run-20260727-008.json)
