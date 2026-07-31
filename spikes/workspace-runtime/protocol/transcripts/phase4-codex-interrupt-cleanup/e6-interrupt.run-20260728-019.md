# E6 — Codex interruption during a tool call

Status: **PARTIAL — protocol interruption works; tool-process cleanup fails**

Date: 2026-07-28

This experiment ran with inherited user configuration and open network access.
Configured MCP integrations were allowed to start. The result does not claim a
clean or reproducible default Codex environment.

## Commands

Run the model-free protocol tests from
`spikes/workspace-runtime/protocol` after adding the E6 reducers and separate
process checks:

```sh
python3 -B test_probe.py
```

Result: 19 tests passed.

Run E6:

```sh
python3 spikes/workspace-runtime/protocol/probe.py codex-interrupt \
  --out spikes/workspace-runtime/protocol/transcripts/phase4-codex-interrupt-cleanup/e6-interrupt.run-20260728-019.json
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
3. `turn/start` asking for exactly one shell command that ran the controlled
   `slow-command.sh` fixture with a unique attempt id
4. `turn/interrupt` with the exact thread and turn ids
5. `turn/start` on the same thread asking for only `AFTER_INTERRUPT_OK`

The probe waited for the command-start event and both exact PID files before
sending the interrupt. It did not use a timer as proof that the tool call had
started.

## Interruption result

The protocol part passed:

- one command item started;
- the shell and child identities matched the unique attempt id;
- the child belonged to the shell, and both shared a process group;
- `turn/interrupt` returned a successful response;
- the terminal turn status was `interrupted`;
- turn event order and the command item id were valid.

Codex emitted no command-completed event before the interrupted turn ended.

## Process cleanup result

The process part failed:

| Controlled process | Running before interrupt | Running after 10-second deadline | Running after fallback cleanup |
| --- | --- | --- | --- |
| Tool shell | yes | **yes** | no |
| Tool child | yes | **yes** | no |

The successful protocol response did not stop either process. The probe then
used its identity-checked fallback cleanup on those two exact PIDs. Two cleanup
actions ran, and a later inspection proved both processes were gone. This
fallback result prevents a test leak; it does not turn the Codex cleanup check
into a pass.

## Connection reuse

The same app-server thread remained usable after interruption. The later turn
emitted four assistant deltas, returned exactly `AFTER_INTERRUPT_OK`, ran no
command, and completed. Only one `thread/start` request occurred. Closing stdin
then stopped app-server with exit code 0.

## Configuration and diagnostic observations

- Inherited user configuration was active.
- 24 MCP startup-status events occurred. These are event counts, not unique
  server counts.
- Raw app-server responses, prompts, model text, command output, command lines,
  and stderr were discarded.
- Only the 395-line stderr count was retained.
- One non-JSON stdout line was classified as the known nono
  `--no-rollback` warning without retaining its text.

## Evidence

The matching machine-readable result is
`e6-interrupt.run-20260728-019.json`. It keeps the protocol checks, separate
shell and child states, fallback result, later-turn checks, event counts, and
redacted process facts.
