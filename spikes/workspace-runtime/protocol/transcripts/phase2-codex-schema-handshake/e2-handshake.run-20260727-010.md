# Phase 2 — Codex initialization state machine

- Run id: `run-20260727-010`
- Status: **PASS**
- Working directory: `<CHIVE_ROOT>`
- Expected: complete the six Phase 2 handshake checks without starting a
  thread or model turn, then exit cleanly.

## Commands run

Run the handshake:

```sh
python3 spikes/workspace-runtime/protocol/probe.py codex-handshake \
  --out spikes/workspace-runtime/protocol/transcripts/phase2-codex-schema-handshake/e2-handshake.run-20260727-010.json
```

Inspect the saved checks, method order, diagnostic counts, and child command:

```sh
jq '{generatedAt, probe: .probes["codex-handshake"] | {runtime, phase, checks, transcript: (.transcript | {argv, exitCode, requestMethods, notificationMethods, serverEventMethodCounts, stderrLineCount, rawResponsesRetained, rawStderrRetained})}}' \
  spikes/workspace-runtime/protocol/transcripts/phase2-codex-schema-handshake/e2-handshake.run-20260727-010.json
```

## Codex child argv

```text
["<CHIVE_ROOT>/spikes/workspace-runtime/confinement/sidecar-harness/target/debug/sidecar-harness", "--nono", "/opt/homebrew/bin/nono", "--profile", "nolabs-ai/codex", "--workspace-rw", "<WORKSPACE>", "--net", "open", "--", "<HOME>/.local/bin/codex", "app-server", "--stdio", "-c", "mcp_servers={}"]
```

## Observed

| Check | Result |
| --- | --- |
| `account/read` before initialization | `Not initialized` error |
| First `initialize` | Returned user-agent, platform, and Codex state-root fields |
| Second `initialize` | `Already initialized` error |
| `initialized` notification | Sent once after the first response |
| Unknown method | Returned one JSONL error |
| Malformed JSON | Wrote one bounded deserialization error to stderr; no JSONL response |
| `account/read` after errors | Returned account presence and type |
| Connection after malformed JSON | Still usable |
| app-server shutdown | Exit code 0 after stdin closed |

The saved `malformedJsonRejected` check is `false` because that check waited for
a JSONL error response. Codex reported the malformed line on stderr instead.
Phase 2 still passes because the plan requires a bounded error for malformed
JSON **or** an unknown method. The unknown method returned an error, the
malformed input produced one diagnostic, and neither corrupted the connection.

No `thread/start`, model turn, or model request ran.

Machine-readable evidence:
[`e2-handshake.run-20260727-010.json`](e2-handshake.run-20260727-010.json)
