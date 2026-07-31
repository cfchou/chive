# Phase 1 — unrelated PID cleanup refusal

- Run id: `run-20260727-006`
- Status: **PASS**
- Working directory: `<CHIVE_ROOT>`
- Expected: fallback cleanup refuses a live PID when its command does not
  contain the exact controlled run ID.

## Operator commands

The focused red and green checks used:

```sh
python3 -B spikes/workspace-runtime/protocol/test_probe.py \
  CleanupSafetyTests.test_cleanup_refuses_a_pid_without_the_exact_run_id
```

The final Phase 1 check used:

```sh
python3 -B spikes/workspace-runtime/protocol/test_probe.py
```

The green runs used normal host process inspection because the managed Codex
sandbox does not permit `/bin/ps`.

## Test-owned child argv

```text
["/bin/sleep", "300"]
```

The expected controlled run ID was `run-20260727-006`. That value was not in
the child's command.

## Red

The helper did not accept a run ID, so it could not enforce exact attempt
identity. The focused test exited with code 1 and reported an unexpected
`run_id` argument.

## Change

- `clean_known_slow_processes()` now requires a keyword-only `run_id`.
- It refuses a live PID unless the command has both a controlled slow-fixture
  shape and the exact run ID.
- All three runtime cleanup call sites now pass their attempt's run ID.

## Green

- Focused test exit code: `0`
- Cleanup result: `refused`
- Unrelated process remained alive after helper returned: yes
- Test stopped and reaped its own process afterward: yes
- Full Phase 1 result: 5 tests passed

No model or network connection was used.

Machine-readable evidence:
[`cleanup-refusal.run-20260727-006.json`](cleanup-refusal.run-20260727-006.json)
