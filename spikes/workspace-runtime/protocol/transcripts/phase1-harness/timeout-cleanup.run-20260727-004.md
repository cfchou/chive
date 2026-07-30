# Phase 1 — timeout cleanup

- Run id: `run-20260727-004`
- Status: **PASS**
- Working directory: `<CHIVE_ROOT>`
- Expected: a bounded wait stops and reaps its owned child before reporting the
  timeout, and local pipe objects are closed.

## Operator command

The same focused command was used for the red and green checks:

```sh
python3 -B spikes/workspace-runtime/protocol/test_probe.py \
  JsonLineProcessTests.test_timeout_stops_and_reaps_the_owned_process
```

After the focused green check, all current harness checks were run together:

```sh
python3 -B spikes/workspace-runtime/protocol/test_probe.py
```

## Local child argv

```text
["/bin/sleep", "300"]
```

## Red

The first wait raised the expected timeout. A second zero-time wait also timed
out, proving that the owned `/bin/sleep` process was still running. The test
exited with code 1.

## Change

- `JsonLineProcess.wait()` now calls owned-process cleanup before it re-raises
  `TimeoutExpired`.
- `JsonLineProcess.close()` now joins both reader threads and closes stdin,
  stdout, and stderr after the child stops.

## Green

- Focused test exit code: `0`
- Timeout still reported to the caller: yes
- A second zero-time wait returned the reaped child's exit code: yes
- The recorded PID no longer existed: yes
- Full local harness result: 3 tests passed
- Unclosed-pipe warnings: none

No model or network connection was used.

Machine-readable evidence:
[`timeout-cleanup.run-20260727-004.json`](timeout-cleanup.run-20260727-004.json)
