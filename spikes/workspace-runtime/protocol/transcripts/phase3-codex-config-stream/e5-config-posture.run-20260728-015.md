# E5 pre-check — inherited Codex configuration posture

Status: **PASS**

Date: 2026-07-28

This pre-check records which broad configuration surfaces are active before
the E5 model turn. It uses normal inherited user configuration. It does not
claim isolation or reproducibility, and it does not send `turn/start`.

## Command

```sh
python3 spikes/workspace-runtime/protocol/probe.py codex-config-posture \
  --out spikes/workspace-runtime/protocol/transcripts/phase3-codex-config-stream/e5-config-posture.run-20260728-015.json
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
3. `config/read` with config layers included
4. `configRequirements/read`
5. `hooks/list`
6. `skills/list`
7. `plugin/installed`
8. `app/installed`
9. `mcpServerStatus/list` with tool-and-auth-only detail

All nine requests succeeded. Closing stdin stopped app-server with exit code 0.

## Sanitized posture snapshot

| Surface | Retained result |
| --- | --- |
| Effective config layers | 2: one system layer and one user layer |
| Config origins | 253 entries, all reported from the user layer |
| Managed requirements | 0 configured fields |
| Hooks | 2 found and enabled; 0 managed; 0 errors; 0 warnings |
| Skills | 74 found; 64 enabled; 0 scan errors |
| Plugins | 17 installed and enabled across 5 marketplaces; 0 load errors |
| Apps | 7 installed, enabled, and callable |
| MCP | 13 servers and 226 tools; no resources or resource templates; no next page |

The effective config object had non-null values in these public groups:

- apps and plugins;
- authentication and provider;
- features;
- hooks;
- MCP;
- model and service;
- sandbox, approvals, and permissions;
- shell environment;
- skills and agents;
- state and diagnostics.

It had no non-null values in the probe's `instructionsAndContext` or
`toolsAndSearch` groups. This does **not** mean no instructions or tools exist.
`AGENTS.md`, skill instructions, built-in tools, and other runtime context can
load outside those effective-config keys.

These counts are a live snapshot and may change when user configuration,
installed capabilities, or runtime state changes. No configured names, paths,
commands, instructions, endpoints, environment values, or credentials were
retained.

## Stream and diagnostic handling

- No model turn started.
- Raw app-server responses were reduced in memory and discarded.
- Raw stderr was discarded; only its 410-line count remains.
- One non-JSON stdout line was classified as the known nono
  `--no-rollback` warning without retaining its text.
- The two MCP startup observations remain consistent with E4: 24 startup-status
  events occurred during initialization.

## Evidence

The matching machine-readable result is
`e5-config-posture.run-20260728-015.json`.
