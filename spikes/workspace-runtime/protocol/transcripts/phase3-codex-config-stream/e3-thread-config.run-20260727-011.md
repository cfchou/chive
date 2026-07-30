# Phase 3 — Codex per-conversation control

- Run id: `run-20260727-011`
- Status: **PASS**
- Working directory: `<CHIVE_ROOT>`
- Expected: initialize one connection, start two ephemeral threads with
  different settings, keep their ids separate, and stop before any model turn.

## Commands run

Run the thread-configuration check:

```sh
python3 spikes/workspace-runtime/protocol/probe.py codex-thread-config \
  --out spikes/workspace-runtime/protocol/transcripts/phase3-codex-config-stream/e3-thread-config.run-20260727-011.json
```

Inspect the saved checks, method order, child command, diagnostic counts, and
unexpected MCP events:

```sh
jq '{generatedAt, probe: .probes["codex-thread-config"] | {runtime, phase, checks, transcript: (.transcript | {argv, exitCode, requestMethods, notificationMethods, serverEventMethodCounts, stderrLineCount, rawResponsesRetained, rawStderrRetained})}}' \
  spikes/workspace-runtime/protocol/transcripts/phase3-codex-config-stream/e3-thread-config.run-20260727-011.json
```

## Codex child argv

```text
["<CHIVE_ROOT>/spikes/workspace-runtime/confinement/sidecar-harness/target/debug/sidecar-harness", "--nono", "/opt/homebrew/bin/nono", "--profile", "nolabs-ai/codex", "--workspace-rw", "<WORKSPACE>", "--net", "open", "--", "<HOME>/.local/bin/codex", "app-server", "--stdio", "-c", "mcp_servers={}"]
```

## Observed

| Setting | Primary thread | Alternate thread |
| --- | --- | --- |
| cwd | `<WORKSPACE>` | `<WORKSPACE>/alternate` |
| sandbox | `dangerFullAccess` | `readOnly` |
| approval policy | `never` | `untrusted` |
| model | `gpt-5.6-sol` | `gpt-5.6-sol` |
| thread id | present | present and different |

All eleven saved checks are `true`. Codex reflected every requested setting,
kept the thread ids separate, and exited with code 0 after stdin closed. The
transcript contains no `turn/start`, so no model turn ran.

The transcript contains 27 `mcpServer/startupStatus/updated` events even though
the launch command and both thread requests used empty MCP maps. That does not
change the E3 settings verdict. It is direct starting evidence for the separate
E4 inherited-configuration isolation check.

Machine-readable evidence:
[`e3-thread-config.run-20260727-011.json`](e3-thread-config.run-20260727-011.json)
