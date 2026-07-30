# E4 — inherited Codex configuration isolation

Status: **PARTIAL — isolation was not achieved; protocol research continues
with inherited user configuration recorded**

Date: 2026-07-27

This finishes E4. It combines the two already-counted app-server attempts with
local checks of every supported candidate from the plan. No model turn ran.

## Operations that directly tested E4

The two counted app-server attempts used these redacted child commands:

```text
<SIDECAR_HARNESS> --nono <NONO> --profile nolabs-ai/codex \
  --workspace-rw <WORKSPACE> --net open -- \
  <CODEX> app-server --stdio

<SIDECAR_HARNESS> --nono <NONO> --profile nolabs-ai/codex \
  --workspace-rw <WORKSPACE> --net open -- \
  <CODEX> app-server --stdio -c 'mcp_servers={}'
```

Each connection sent `initialize`, then `initialized`, then this request. Only
the request id differed:

```json
{
  "id": 7,
  "method": "thread/start",
  "params": {
    "cwd": "<WORKSPACE>",
    "sandbox": "danger-full-access",
    "approvalPolicy": "never",
    "ephemeral": true,
    "model": "gpt-5.6-sol",
    "config": { "mcp_servers": {} }
  }
}
```

The final supported-seam check inspected these local command surfaces and kept
only counts or flag presence:

```sh
codex app-server --help
codex exec --help
codex mcp list --help
codex mcp list --json
codex mcp list -c 'mcp_servers={}' --json
codex mcp list -c 'mcp_servers.<MCP_SERVER>.enabled=false' --json
CODEX_HOME=<FRESH_STATE_ROOT> codex login status
codex app-server generate-json-schema --out <TEMP_SCHEMA_DIR>
```

The per-server form ran once for each of the 14 listed entries. The local final
candidate repeated its 12 accepted disable overrides, added 11 public feature
switches and `apps._default.enabled=false`, and kept only aggregate counts.

The stable schema showed read methods for effective config layers,
requirements, hooks, skills, plugins, apps, and MCP status. It also showed
per-thread fields for config, instructions, model/provider, sandbox, approvals,
personality, service tier, cwd, and ephemeral state. Those fields do not prove
that lower layers are absent.

Create the final redacted result from the counted attempts and local-only
config, flag, and login checks:

```sh
python3 -B spikes/workspace-runtime/protocol/probe.py codex-config-isolation-final \
  --out spikes/workspace-runtime/protocol/transcripts/phase3-codex-config-stream/e4-config-isolation-final.run-20260727-013.json
```

## Counted app-server results

| Attempt | MCP startup-status events | App-server exit | Result |
| --- | ---: | ---: | --- |
| Empty thread-level MCP map | 24 | 0 | Did not isolate inherited configuration |
| Empty launch-level and thread-level MCP maps | 24 | 0 | Did not isolate inherited configuration |

These are event counts, not unique server counts. Both connections initialized
and stopped cleanly. Neither sent `turn/start`.

## Candidate checks

| Candidate | Result |
| --- | --- |
| Native app-server ignore flags | Missing. The installed `exec` command has `--ignore-user-config` and `--ignore-rules`; `app-server` has neither. |
| Empty `mcp_servers` map | Does not replace the lower config layer. Normal and empty-map inventory counts were identical: 14 configured and 13 enabled. |
| One disable override per listed server, plus feature-family switches | The current local snapshot reached 0 enabled entries, but 2 of 14 listed entries did not accept the per-server override. More importantly, listing names and launching later has a config-change race. The candidate was not started. |
| Fresh `CODEX_HOME` | `codex login status` exited 1. No saved login was available there, and `CODEX_ACCESS_TOKEN` was not set. |

The per-name candidate cannot meet the plan's race-safety rule even when its
current snapshot is empty. Starting it could also launch user-configured MCP
servers if config changed after the list step. A requested live rerun was
therefore blocked before execution, and the final check used local config
inspection only.

## Technical result and continuation decision

Codex 0.145.0 has no supported seam in this environment that is all of:

- complete for user-level config, rules, tools, hooks, skills, plugins, and MCP;
- race-safe between readiness and launch;
- usable with the accepted saved-login posture;
- secret-safe and compatible with the nono sidecar boundary.

E4 does not prove configuration isolation. MCP is only one inherited config
surface; Codex can also load instructions, skills, hooks, plugins, apps,
feature flags, model and execution defaults, shell environment policy, and
other state.

E4 is therefore **PARTIAL**, not a showstopper. E5–E7 may continue with normal
saved-login state as long as every result says it used inherited user
configuration. S4 must later choose and document whether the product preserves,
limits, or isolates that configuration; full isolation is not a prerequisite
for continuing this protocol spike.

Official references checked:

- [Codex app-server command](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-app-server)
- [Codex environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables)
- [One-off CLI config overrides](https://learn.chatgpt.com/docs/config-file/config-advanced#one-off-overrides-from-the-cli)

## Security note

One exploratory diagnostic printed the raw MCP list, including configured
environment fields, into tool output. It was not written to this repository or
to an evidence artifact. The affected credentials should be rotated. No names,
values, or endpoints are repeated here.

## Evidence

The matching machine-readable result is
`e4-config-isolation-final.run-20260727-013.json`. It retains only counts,
booleans, exit codes, and redacted summaries.
