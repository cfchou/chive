# Phase 1 — stderr drain

- Run id: `run-20260727-003`
- Status: **PASS**
- Working directory: `<CHIVE_ROOT>`
- Expected: stdout remains readable after the local child writes more stderr
  data than a normal pipe can hold.

## Operator command

```sh
python3 -B spikes/workspace-runtime/protocol/test_probe.py \
  JsonLineProcessTests.test_full_stderr_pipe_does_not_block_stdout
```

## Local child argv

```text
["<PYTHON>", "-u", "-c", "<write 1 MiB to stderr, then write known JSON to stdout>"]
```

## Observed

- Test exit code: `0`
- Local child exit code: `0`
- Stderr written before stdout: `1,048,576` bytes
- Retained stdout message: `{"stdout": "still-readable"}`
- Result: concurrent stderr draining prevented a pipe deadlock.

Python initially reported that the finished child's stdout and stderr pipe
objects were not closed. The timeout-cleanup slice in `run-20260727-004` fixed
that shared cleanup path, and the three checks now pass together without the
warning.

Machine-readable evidence:
[`stderr-drain.run-20260727-003.json`](stderr-drain.run-20260727-003.json)
