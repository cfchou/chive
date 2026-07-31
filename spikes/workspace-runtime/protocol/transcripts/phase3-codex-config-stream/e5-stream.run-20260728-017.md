# E5 — Codex stream fidelity and same-thread reuse

Status: **PASS**

Date: 2026-07-28

This experiment ran with inherited user configuration and open network access.
Configured MCP integrations were allowed to start. The result does not claim a
clean or reproducible default Codex environment.

## Commands

Confirm that macOS reports the same temporary directory with a resolved
`/private/var` spelling. This command retained only comparison booleans and a
length difference, not the path:

```sh
python3 -c 'import json, pathlib, subprocess, tempfile; d=tempfile.TemporaryDirectory(prefix="chive-sp2-codex-stream-"); p=pathlib.Path(d.name); out=subprocess.run(["/bin/pwd"], cwd=p, text=True, capture_output=True, check=True).stdout.strip(); print(json.dumps({"pwdEqualsPath": out == str(p), "pwdEqualsResolvedPath": out == str(p.resolve()), "lengthDeltaFromPath": len(out)-len(str(p))}))'
```

Result:

```json
{"pwdEqualsPath": false, "pwdEqualsResolvedPath": true, "lengthDeltaFromPath": 8}
```

Run the model-free protocol tests from
`spikes/workspace-runtime/protocol` after teaching the checker about that path
alias and the completed-item output form:

```sh
python3 -B test_probe.py
```

Result: 17 tests passed.

Run E5:

```sh
python3 spikes/workspace-runtime/protocol/probe.py codex-stream \
  --out spikes/workspace-runtime/protocol/transcripts/phase3-codex-config-stream/e5-stream.run-20260728-017.json
```

The counted app-server child ran through the existing sidecar and nono:

```text
<SIDECAR_HARNESS> --nono /opt/homebrew/bin/nono \
  --profile nolabs-ai/codex --workspace-rw <WORKSPACE> --net open -- \
  <CODEX> app-server --stdio
```

## Protocol operations

The client sent these requests in order:

1. `initialize`
2. `thread/start` for one ephemeral controlled-workspace thread
3. `turn/start` asking for exactly one shell command that ran
   `/bin/pwd && /bin/cat ./probe-marker.txt`
4. `turn/start` on the same thread asking for only `SECOND_TURN_OK`

Closing stdin stopped app-server with exit code 0.

## First turn

All checks passed:

- one command item started before it completed;
- the command used the requested controlled cwd and exited 0;
- the completed command item contained exactly `<WORKSPACE>` followed by
  `CHIVE_SP2_MARKER`;
- command item ids stayed stable;
- assistant text arrived in 69 deltas, and each completed assistant item
  exactly matched its deltas;
- assistant item ids stayed stable;
- the final assistant item contained the workspace and marker;
- `turn/started` came before the items, `turn/completed` came after them, and
  the final status was `completed`.

Codex did not emit `item/commandExecution/outputDelta`. It represented the
command output without loss in the completed command item instead. This is one
of the two forms allowed by the E5 plan.

macOS reported the controlled temporary directory through its resolved
`/private/var` spelling. The checker accepts the original and resolved
spellings only when the marker and complete two-line output also match.

## Second turn

The second turn reused the same runtime thread. It emitted four assistant
deltas, completed normally, returned exactly `SECOND_TURN_OK`, and started no
command item. Only one `thread/start` and two `turn/start` requests occurred.

## Configuration and diagnostic observations

- Inherited user configuration was active.
- 24 MCP startup-status events occurred. These are event counts, not unique
  server counts.
- Raw app-server responses and raw stderr were discarded.
- Only the 394-line stderr count was retained.
- One non-JSON stdout line was classified as the known nono
  `--no-rollback` warning without retaining its text.
- The app-server process exited with code 0 after both turns.

## Evidence

The matching machine-readable result is
`e5-stream.run-20260728-017.json`. It retains only the controlled command
output, event shapes and counts, checks, and redacted process facts.
