# SP2 headless runtime findings

Status: **SP2 complete. Codex is VIABLE PROTOCOL / PRODUCTION BLOCKED. Claude
Code and OpenCode are VIABLE at their planned smoke depth.**

Issue: [#48](https://github.com/cfchou/chive/issues/48)

Boundary used by these tests:
[SP1 confinement findings](../confinement/findings.md)

## Current conclusion

Codex 0.145.0 has a usable JSONL app-server surface for initialization and
per-conversation settings. Chive can initialize one connection, start separate
ephemeral threads, and set each thread's working directory, sandbox mode,
approval policy, and model.

The two tested empty-map seams did not clear inherited MCP configuration. Codex
0.145.0 exposes config and rules ignore flags for `exec`, but not for
`app-server`. The remaining supported candidates were either unauthenticated or
race-prone. This proves only that one part of user configuration is inherited;
it does not describe the whole configuration surface.

The current Codex status is **VIABLE PROTOCOL / PRODUCTION BLOCKED**:

- protocol initialization: viable;
- per-conversation settings: viable;
- inherited configuration posture: **PARTIAL**; MCP inheritance was observed
  and the broader surface still needs research;
- model streaming and same-thread multi-turn behavior: viable;
- protocol interruption and later connection reuse: viable;
- tool-process cleanup on `turn/interrupt`: failed for both controlled
  processes;
- app-server PID, app-server process group, and outer sidecar process group
  cleanup: failed for both controlled processes;
- production requirement: add and test a stronger process-tree lifecycle
  boundary that owns descendants leaving the adapter group;
- Claude Code one-shot stream and supervised-group cleanup: viable;
- OpenCode one-shot stream, server event, session abort, and cleanup: viable at
  the planned smoke depth.

E5–E7 ran model turns with inherited user configuration and open network
access. They do not establish a clean or reproducible default environment.

## Audit results

| Work | Result | What the evidence establishes |
| --- | --- | --- |
| Phase 0 — tested stack | **PASS** | The sidecar builds; exact runtime versions, executable hashes, profiles, models, and saved-login readiness are recorded. |
| Phase 1 — local harness | **PASS** | JSONL parsing, stderr draining, timeouts, redaction, controlled workspace files, PID identity, and owned-process cleanup behave as required. |
| E1 — generated Codex schemas | **PASS** | The stable schema contains the requests and fields needed by the planned adapter. |
| E2 — initialization state machine | **PASS** | Initialization order, repeat rejection, account access, bounded protocol errors, continued connection use, and clean shutdown were observed. |
| E3 — per-conversation control | **PASS** | Two ephemeral threads kept different cwd, sandbox, and approval settings and returned different thread ids. |
| E4 — inherited user configuration | **PARTIAL** | No complete isolation seam passed. MCP inheritance is confirmed, broader config research remains, and E5–E7 record that they used inherited config. |
| E5 pre-check — inherited config posture | **PASS** | All seven read-only posture methods succeeded. Raw responses were discarded after reducing them to public groups and anonymous counts. No model turn ran. |
| E5 — stream fidelity and same-thread reuse | **PASS** | One controlled command and two turns completed on one thread. Assistant deltas were lossless, command output was complete on the completed item, and raw responses and stderr were discarded. |
| E6 — interrupt during tool call | **PARTIAL** | `turn/interrupt` was acknowledged, the turn became `interrupted`, and the same thread remained usable. The controlled shell and child both survived the deadline and required identity-checked fallback cleanup. |
| E7 — runtime loss and outer cleanup | **FAIL** | App-server PID, app-server group, and outer sidecar group termination all stopped the runtime boundary but left the controlled shell and child alive in a separate group. No existing final candidate passed. |
| Phase 5 — Claude Code smoke | **PASS** | The normal one-shot JSONL stream and controlled Bash command succeeded. During the interruption turn, supervised-group `TERM` stopped Claude, the exact tool shell, and its child without `KILL` or fallback cleanup. |
| Phase 6 — OpenCode smoke | **PASS** | The normal JSON stream completed the controlled Bash command. The server stream exposed a live Bash start, the session abort stopped the exact shell and child without fallback cleanup, the test session was deleted, and the server stopped. |

## Capability matrix

The cells describe only the tested depth. A narrow smoke-test pass does not
mean Claude Code or OpenCode received every deeper Codex check.

| Capability | Codex 0.145.0 | Claude Code 2.1.218 | OpenCode 1.18.4 |
| --- | --- | --- | --- |
| Launch/headless readiness | **PASS** — direct app-server launch, bounded initialization, and reap passed. [E2](transcripts/phase2-codex-schema-handshake/e2-handshake.run-20260727-010.md) | **PASS** — direct print-mode launch and bounded exit passed. [Phase 5](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md) | **PASS** — direct run launch plus bounded local-server readiness and shutdown passed. [Phase 6](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md) |
| Auth probe behavior | **PASS** — saved-login readiness and sanitized account presence/type were observed. [Phase 0](transcripts/phase0-inventory/run-20260727-001.md), [E2](transcripts/phase2-codex-schema-handshake/e2-handshake.run-20260727-010.md) | **PASS** — the sanitized auth probe reported logged in. [Phase 5](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md) | **PASS** — the sanitized auth probe found saved credential entries without retaining provider names. [Phase 6](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md) |
| Handshake | **PASS** — initialization order, repeat rejection, bounded errors, and later connection use passed. [E2](transcripts/phase2-codex-schema-handshake/e2-handshake.run-20260727-010.md) | **NOT TESTED** — the one-shot CLI has no separate client handshake in this smoke test; its init event was checked instead. [Phase 5](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md) | **NOT TESTED** — the smoke used one-shot run plus a created server session, not a separate client handshake. [Phase 6](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md) |
| Cwd/config posture | **PARTIAL** — cwd and per-thread settings passed, but inherited config remained and no race-safe isolation seam passed. [E3](transcripts/phase3-codex-config-stream/e3-thread-config.run-20260727-011.md), [E4](transcripts/phase3-codex-config-stream/e4-config-isolation-final.run-20260727-013.md), [E5 posture](transcripts/phase3-codex-config-stream/e5-config-posture.run-20260728-015.md) | **PARTIAL** — controlled cwd and narrow safe-mode/MCP settings passed; the broader inherited surface was not inventoried. [Phase 5](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md) | **PARTIAL** — controlled cwd and `--pure` plugin behavior passed; broader inherited context was allowed and not inventoried. [Phase 6](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md) |
| Sandbox/approval control | **PASS** — nono was the outer boundary; Codex reflected `dangerFullAccess` and `never`. [E3](transcripts/phase3-codex-config-stream/e3-thread-config.run-20260727-011.md) | **PASS** — nono was outermost; Claude's inner sandbox was disabled and bypass permission mode was observed. [Phase 5](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md) | **PASS** — nono was outermost; OpenCode had no inner shell sandbox and `--auto` made approval behavior explicit. [Phase 6](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md) |
| Structured stream/event fidelity | **PASS** — tool start/completion, lossless assistant deltas, terminal status, and same-thread second turn passed. [E5](transcripts/phase3-codex-config-stream/e5-stream.run-20260728-017.md) | **PASS** — partial, assistant, tool-use, tool-result, and successful result events were valid JSONL. [Phase 5](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md) | **PASS** — one-shot JSON supplied completed tool/text/step events and server SSE supplied the separate live tool start. [Phase 6](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md) |
| Interruption mid-tool-call | **PASS** — `turn/interrupt` was acknowledged, status became interrupted, and a later same-thread turn passed. [E6](transcripts/phase4-codex-interrupt-cleanup/e6-interrupt.run-20260728-019.md) | **PARTIAL** — supervised-group `TERM` stopped the session, but there was no protocol acknowledgement, terminal turn status, or later-turn reuse check. [Phase 5](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md) | **PARTIAL** — server abort succeeded and the session was no longer busy, but later-session reuse was not tested. [Phase 6](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md) |
| Process-tree cleanup | **FAIL** — protocol interrupt and all three runtime boundaries left both tool processes alive; identity-checked fallback cleanup was required. [E6](transcripts/phase4-codex-interrupt-cleanup/e6-interrupt.run-20260728-019.md), [E7](transcripts/phase4-codex-interrupt-cleanup/e7-lifecycle.run-20260730-020.md) | **PARTIAL** — PID/parent/group checks passed and `TERM` stopped both tool processes, but a separate forced-stop path was not tested. [Phase 5](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md) | **PARTIAL** — PID/parent/group checks passed and server abort stopped both tool processes, but multiple runtime-loss and forced-stop paths were not tested. [Phase 6](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md) |
| Version pinning/update risk | **PASS** — version, executable hash, stable schema, and experimental schema were frozen. Regenerate and compare canonical JSON hashes on update. [Phase 0](transcripts/phase0-inventory/run-20260727-001.md), [E1](transcripts/phase2-codex-schema-handshake/e1-schema.run-20260731-025.md) | **PASS** — version and executable hash were frozen and the live version matched. Recheck CLI event shapes on update. [Phase 0](transcripts/phase0-inventory/run-20260727-001.md), [Phase 5](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md) | **PASS** — the global command changed, so the probe used the cached 1.18.4 binary and verified the frozen hash before model work. [Phase 0](transcripts/phase0-inventory/run-20260727-001.md), [Phase 6](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md) |
| Diagnostics redaction | **PASS** — retained E1–E7 artifacts use reduced counts/statuses and omit raw model/config/diagnostic content. [E5](transcripts/phase3-codex-config-stream/e5-stream.run-20260728-017.md), [E7](transcripts/phase4-codex-interrupt-cleanup/e7-lifecycle.run-20260730-020.md) | **PASS** — prompts, model text, raw responses, commands, process command lines, and stderr were not retained. [Phase 5](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md) | **PASS** — prompts, assistant text, HTTP bodies, SSE payloads, console output, process commands, and identities were not retained. [Phase 6](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md) |
| Known showstoppers and required wrapper behavior | **FAIL** — no protocol showstopper, but production is blocked until a Chive-owned boundary proves complete descendant cleanup; inherited-config policy also remains an S4 decision. [E4](transcripts/phase3-codex-config-stream/e4-config-isolation-final.run-20260727-013.md), [E7](transcripts/phase4-codex-interrupt-cleanup/e7-lifecycle.run-20260730-020.md) | **PASS** — no smoke-depth showstopper; the wrapper must launch a supervised group, signal it, verify the exact descendants, and reap it. [Phase 5](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md) | **PASS** — no smoke-depth showstopper; the wrapper needs run-mode streaming plus a server session for live start/abort, followed by session deletion and server reap. [Phase 6](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md) |

### Runtime verdicts

- Codex: **VIABLE PROTOCOL / PRODUCTION BLOCKED**. Its stable protocol meets
  the adapter needs, but no tested boundary cleans up the detached tool tree.
- Claude Code: **VIABLE** at the planned one-shot smoke depth. Its production
  wrapper must preserve the tested supervised-group cleanup behavior.
- OpenCode: **VIABLE** at the planned smoke depth. Its wrapper needs both the
  one-shot JSON stream and local server control path tested here.

### Gate impact

- S4 cannot claim production-ready Codex lifecycle handling until a stronger
  descendant-owning boundary passes normal interruption and forced-stop tests.
- S4 must choose and document whether inherited runtime configuration is
  preserved, limited, or isolated. MCP is only one part of that decision.
- SP2 supplies evidence, not replay fixtures. If S5's adapter tests need replay
  fixtures, create only the fixtures those tests consume and assert against.
- S6 must keep protocol cancellation, runtime exit, tool-process cleanup, and
  fallback cleanup as separate user-visible states.

## Tested stack

| Runtime | Version | Nono profile | Planned model |
| --- | --- | --- | --- |
| Codex | `0.145.0` | `nolabs-ai/codex` | `gpt-5.6-sol` |
| Claude Code | `2.1.218` | `nolabs-ai/claude` | `claude-sonnet-4-6` |
| OpenCode | `1.18.4` | `opencode-0723a` | `github-copilot/gpt-5.6-terra` |

Nono is `0.69.0`. All three selected profiles validated, their retained hashes
matched the accepted SP1 snapshot, and all three runtimes had saved login state.
The exact executable and profile hashes are in the Phase 0 evidence.

## Harness findings

The local harness passed these checks without contacting a model:

- A non-JSON stdout line is kept as an explicit `unparsed` record.
- A child can write 1 MiB to stderr without blocking its JSON stdout.
- A timed-out child is stopped, reaped, and has its local pipes closed.
- Synthetic emails, tokens, home paths, MCP names, and private hostnames are
  replaced with stable placeholders.
- A temporary workspace contains only the marker, slow command, and controlled
  Claude settings file, then is deleted.
- Fallback cleanup refuses a PID unless its command has the controlled shape
  and exact run id.
- The slow fixture's shell and child have identifiable PIDs, share one process
  group, and both stop when the shell receives TERM.

These checks reduce harness-caused false results. They do not prove that a real
runtime will stop every tool process; E6 and E7 test that separately below.

## Codex protocol findings

### E1 — generated surface

The installed Codex binary generated 273 stable schema files and 347
experimental schema files. The stable V2 bundle contains:

- `initialize`;
- `account/read`;
- `thread/start`;
- `turn/start`;
- `turn/interrupt`;
- the `initialized` client notification;
- the planned cwd, sandbox, approval, input, thread-id, and turn-id fields.

Future adapter work should use the stable surface. Experimental fields are not
requirements unless a later decision says otherwise.

Codex can emit the same schema with a different JSON object-key order. E1
therefore records canonical JSON hashes, which stayed equal across two fresh
generations from the frozen executable.

### E2 — initialization

The counted handshake observed this order:

1. `account/read` before initialization returned `Not initialized`.
2. The first `initialize` returned platform and Codex state-root fields.
3. A second `initialize` returned `Already initialized`.
4. The client sent `initialized` once.
5. An unknown method returned a JSONL error.
6. Malformed JSON produced one bounded stderr diagnostic rather than a JSONL
   response.
7. A later `account/read` still worked and returned only retained account
   presence and type.
8. Closing stdin produced app-server exit code 0.

The malformed-input channel differs from the probe's first assumption, but the
connection stayed usable and the plan's bounded-error alternative passed.

### E3 — per-conversation settings

One initialized connection started two ephemeral threads:

| Setting | Primary thread | Alternate thread |
| --- | --- | --- |
| cwd | `<WORKSPACE>` | `<WORKSPACE>/alternate` |
| sandbox | `dangerFullAccess` | `readOnly` |
| approval policy | `never` | `untrusted` |
| model | `gpt-5.6-sol` | `gpt-5.6-sol` |

Codex reflected every value and returned separate thread ids. No `turn/start`
was sent, and app-server exited with code 0.

### E4 — inherited configuration isolation

E3 unexpectedly contained 27 `mcpServer/startupStatus/updated` events. The
dedicated E4 comparison then measured:

| Attempt | MCP startup events | Result |
| --- | ---: | --- |
| Empty thread-level MCP map | 24 | failed to block startup |
| `-c mcp_servers={}` plus empty thread-level map | 24 | failed to block startup |

These numbers are protocol event counts, not unique server counts. A server can
emit more than one status update. The evidence needs only the non-zero result,
so configured server names are not retained in the final E4 artifact.

Both attempts initialized and exited cleanly, and neither started a model turn.
The failure is about inherited startup work, not app-server availability.

The remaining checks found:

- `codex exec` exposes `--ignore-user-config` and `--ignore-rules`, but the
  installed `codex app-server` exposes neither.
- A normal MCP inventory and `-c mcp_servers={}` both reported 14 configured
  entries and 13 enabled entries. An empty table overlays lower config; it does
  not delete lower entries.
- Per-server disables were accepted for 12 of 14 listed entries. Adding the
  public feature-family switches produced a local snapshot with 0 enabled
  entries, but this is not a safe launch seam: config can change between the
  list and launch operations.
- A fresh `CODEX_HOME` could not reuse saved login, and `CODEX_ACCESS_TOKEN`
  was not available in this environment.

The race-prone candidate was not started. A live rerun was blocked before it
ran because normal user configuration could start MCP servers toward unknown
destinations. Starting the remaining candidate could not change the verdict:
it already failed the plan's race-safety rule.

The isolation result remains negative, but it is not a protocol showstopper.
E5–E7 can continue with normal saved-login state as long as the evidence says
that inherited user configuration was active.

MCP is only one documented part of the wider surface. Later checks must keep
these groups visible without retaining private values:

- config layers: CLI, trusted project, profile, user, system, built-in, and
  managed requirements;
- model and execution defaults: provider, model, reasoning, sandbox, approvals,
  permissions, shell environment, network, and feature flags;
- prompt and context: user instructions, `AGENTS.md`, instruction files,
  skills, agent roles, and enabled memories;
- executable and external behavior: hooks, MCP, apps/connectors, plugins,
  shell, web search, browser tools, and computer-use tools;
- state and diagnostics: authentication, sessions, logs, and telemetry.

The E5 posture check used the stable app-server's read-only methods:
`config/read` with layer origins,
`configRequirements/read`, `hooks/list`, `skills/list`, `plugin/installed`,
`app/installed`, and `mcpServerStatus/list`. The installed methods report
effective installed state without loading full catalogs. Their private
contents must be reduced in memory to config-group names, layer kinds, counts, and enabled/disabled
booleans before evidence is saved.

The same schema shows that `thread/start` can request `config`,
`baseInstructions`, `developerInstructions`, model/provider, sandbox, approval,
personality, service tier, cwd, and ephemeral state. These are useful
per-thread controls, but their presence does not mean lower config layers were
cleared.

S4 must choose and document whether Chive preserves, limits, or isolates these
surfaces. Full isolation can remain a later wrapper or product option; it is not
a prerequisite for continuing SP2.

### E5 pre-check — inherited config posture

The pre-check initialized one normal app-server connection under the sidecar,
started one ephemeral controlled-workspace thread, and called:

- `config/read` with layers;
- `configRequirements/read`;
- `hooks/list`;
- `skills/list`;
- `plugin/installed`;
- `app/installed`;
- `mcpServerStatus/list`.

All reads succeeded. The reduced snapshot contained:

| Surface | Counted posture |
| --- | --- |
| Config layers | 2: one system and one user layer |
| Config origins | 253 user-layer entries |
| Managed requirements | 0 configured fields |
| Hooks | 2 found and enabled |
| Skills | 74 found; 64 enabled |
| Plugins | 17 installed and enabled across 5 marketplaces |
| Apps | 7 installed, enabled, and callable |
| MCP | 13 servers and 226 tools |

These are live environment counts, not stable expected values. No configured
identities or values were retained. The effective config response had no
non-null `instructionsAndContext` or `toolsAndSearch` keys, but that does not
prove instructions or tools are absent: `AGENTS.md`, skills, built-in tools,
and other context can load through separate surfaces.

No `turn/start` request was sent. App-server exited cleanly. One non-JSON stdout
line was classified as the known nono `--no-rollback` warning, and raw stderr
was discarded after its line count was recorded.

### E5 — stream fidelity and same-thread reuse

E5 initialized one normal app-server connection under the sidecar, started one
ephemeral controlled-workspace thread, and ran two turns on that thread.
Inherited user configuration and open network access were active.

The first turn asked Codex to use the shell exactly once for:

```text
/bin/pwd && /bin/cat ./probe-marker.txt
```

One command item started and completed with a stable item id, the requested
cwd, and exit code 0. Its completed item contained exactly the controlled
workspace path and `CHIVE_SP2_MARKER`. Codex emitted no command-output delta
event; it represented the output without loss on the completed command item,
which is allowed by the E5 acceptance rule.

The first turn produced 69 assistant deltas across two assistant items. Each
item's deltas concatenated exactly to its completed text, item ids stayed
stable, event order was valid, and the turn completed. The second turn used the
same thread, produced four assistant deltas, returned exactly
`SECOND_TURN_OK`, ran no command, and completed. The whole connection issued
one `thread/start` and two `turn/start` requests, then app-server exited 0.

The initial analysis compared `/bin/pwd` literally with the path returned by
Python's temporary-directory API. On macOS those may be `/private/var/...` and
`/var/...` spellings of the same directory. A local check confirmed the
resolved path matches. The corrected checker accepts only the original or
resolved workspace spelling while still requiring the exact two-line
controlled output. Seventeen model-free tests passed before the counted rerun.

Raw model responses and raw stderr were not retained. The evidence keeps the
controlled output, event shapes and counts, and redacted process facts. The run
observed 24 MCP startup-status events and one known nono `--no-rollback`
warning. These inherited-config observations do not change the E5 protocol
result.

### E6 — interruption during a tool call

E6 started one controlled slow command, then waited for the command-start event
and both exact PID files before sending `turn/interrupt`. The PID check proved
the shell and child carried the unique attempt id, the child belonged to the
shell, and both shared one process group.

The protocol interruption worked: Codex acknowledged the request, emitted one
terminal `turn/completed` event with status `interrupted`, and kept the same
thread usable. A later turn returned exactly `AFTER_INTERRUPT_OK`, ran no
command, and completed. App-server then exited 0 after stdin closed.

Process cleanup did not work. After the 10-second deadline, both the controlled
shell and its child were still alive. No command-completed event arrived before
the interrupted turn ended. The probe's identity-checked fallback then killed
the two exact processes, and a later inspection proved both were gone.

These results must stay separate:

- protocol interruption: **PASS**;
- terminal interrupted status: **PASS**;
- tool shell stopped by Codex: **FAIL**;
- tool child stopped by Codex: **FAIL**;
- same-thread connection reuse: **PASS**;
- fallback left no controlled process: **PASS**, but this is harness safety,
  not Codex cleanup evidence.

E6 is therefore **PARTIAL**. It establishes a usable interruption protocol but
also a concrete cleanup gap. E7 must now test app-server and outer-supervisor
loss boundaries before the final Codex production verdict is chosen.

The run used inherited user configuration and observed 24 MCP startup-status
events. Raw responses, prompts, model text, command output, process command
lines, and stderr were not retained. Nineteen model-free tests passed before
the counted run.

### E7 — runtime loss and outer cleanup boundaries

E7 ran three fresh controlled turns and resolved every process role through its
parent lineage before signalling anything. All three attempts observed the
same topology:

- sidecar, nono, and app-server shared one process group;
- tool shell and child shared a different process group;
- the tool shell initially descended from app-server;
- after the runtime stopped, the shell was reparented to PID 1 and kept running
  with its child.

The app-server group and outer sidecar group were the same signal target in the
installed stack. E7 still ran them as separate attempts because the plan treats
their ownership concepts separately.

| Boundary | Runtime boundary stopped | Tool shell stopped | Tool child stopped |
| --- | --- | --- | --- |
| App-server PID with `TERM` | yes | **no** | **no** |
| App-server group with `TERM` | yes | **no** | **no** |
| Outer sidecar group with `TERM` | yes | **no** | **no** |

Each selected PID or group disappeared after `TERM`, so no `KILL` escalation
was sent. The surviving tool processes were already in another process group;
signalling the disappeared original group again could not reach them.

Every attempt required two identity-checked fallback cleanup actions. A later
inspection proved the exact shell and child were gone each time. This is test
harness safety, not a passing lifecycle boundary.

No existing boundary stopped both controlled processes, so there was no final
candidate and no fourth session. The final Codex verdict is therefore
**VIABLE PROTOCOL / PRODUCTION BLOCKED**. S4 requires a stronger process-tree
supervisor that can discover and stop descendants which create another process
group or become reparented. That boundary must pass normal and forced-stop
tests before production use.

E7 used inherited user configuration and open network access. Three sessions
ran, each with 24 MCP startup-status events. Raw responses, prompts, model text,
commands, configured identities, endpoints, credentials, and stderr were not
retained. Twenty model-free tests passed before E7.

## Claude Code findings

### Phase 5 — normal stream and supervised cleanup

Claude Code 2.1.218 ran through the SP1 sidecar and `nolabs-ai/claude` profile
with open network access. It used the saved login, `claude-sonnet-4-6`, safe
mode, a strict empty MCP config, Bash-only tools, no session persistence, and a
controlled settings file that disabled Claude's inner sandbox.

The normal turn reported the controlled cwd and bypass permission mode. Its
valid JSONL stream included init, partial stream, assistant, Bash tool-use,
tool-result, and successful result events. Claude requested exactly:

```text
/bin/pwd && /bin/cat ./probe-marker.txt
```

The controlled output and final reply contained the workspace and
`CHIVE_SP2_MARKER`. The process exited 0.

The second session reached the controlled slow command. Before signalling, the
probe proved that the shell and child had the unique run ID, the child belonged
to the shell, and both shared one process group. `TERM` sent to the supervised
process group stopped Claude, the shell, and the child. `KILL` was not needed,
and fallback cleanup performed zero actions.

These results are separate from Codex E6 and E7. Claude's tested one-shot
wrapper cleanup passed; Phase 5 did not test a protocol interrupt request,
interrupted turn status, later-turn reuse, or multiple runtime boundaries.

Raw prompts, model text, protocol responses, process command lines, and stderr
were not retained. The run stored only controlled output and reduced event,
launch, signal, and process facts. Phase 5 is **PASS**.

## OpenCode findings

### Phase 6 — normal stream, server abort, and cleanup

The probe launched the exact cached OpenCode 1.18.4 binary through the SP1
sidecar and `opencode-0723a` profile with open network access. Its SHA-256
matched the Phase 0 inventory. Saved credentials were available. `--pure`
disabled external OpenCode plugins and `--auto` avoided tool approval prompts;
other OpenCode context could still be inherited.

The normal `opencode run --format json` turn emitted valid step-start,
completed Bash tool, step-finish, and assistant-text records. The controlled
command returned the workspace and `CHIVE_SP2_MARKER`, and the process exited
0. Version 1.18.4 did not provide a separate live tool-start record on this
one-shot interface.

The second attempt used `opencode serve` on loopback. Its SSE stream exposed
the controlled Bash part in the `running` state. Before aborting, the probe
confirmed the exact shell and child PIDs, that the child belonged to the
shell, and that both shared one process group. The session abort route returned
success. Both processes were gone at the first post-abort inspection, so
identity-checked fallback cleanup performed zero actions. The test session was
no longer busy, was deleted, and the local server stopped.

Raw prompts, assistant text, HTTP bodies, server events, console output,
configured identities, credentials, and process command lines were not
retained. The run stored controlled output and reduced launch, event, process,
abort, deletion, and cleanup facts. Phase 6 is **PASS** at the planned smoke
depth. It did not test later-turn reuse, multiple runtime-loss boundaries, or
a forced-`KILL` path.

## Diagnostics and redaction contract

Future adapters should keep the same boundary used by this spike:

- Inspect protocol messages and diagnostics in memory, then persist or display
  only allowlisted fields.
- Keep runtime version and hash, native method or event name, event count,
  terminal status, exit or signal result, controlled marker output, and
  reduced process relationships.
- Replace private paths with `<WORKSPACE>`, `<HOME>`, or `<CHIVE_ROOT>` before
  data crosses the diagnostics boundary.
- Do not retain raw prompts, assistant text, arbitrary tool output, stderr,
  HTTP bodies, server-event payloads, process command lines, account details,
  configured identities, endpoints, environment values, or authentication
  material.
- Drain stderr so a full pipe cannot block the runtime. Keep only a redacted
  diagnostic classification and line count unless an allowlist explicitly
  permits more.
- Treat unknown or malformed output as an explicit parse failure after
  redaction. Do not silently drop it and do not show its raw text to the user.
- Run the privacy scan before accepting new evidence or exposing diagnostics
  through the AI Chat Sidebar.

SP2 retains no protocol replay fixtures. The three files under
`fixtures/workspace/` are controlled test inputs, not future adapter outputs.

## Verify the retained evidence

```sh
cd spikes/workspace-runtime/protocol
PYTHONPYCACHEPREFIX=/tmp/chive-sp2-pycache \
  python3 -m py_compile probe.py test_probe.py
PYTHONPYCACHEPREFIX=/tmp/chive-sp2-pycache \
  python3 -m unittest -v test_probe.py
find transcripts -name '*.json' -print0 | xargs -0 -n1 jq empty
```

## Important limits

- SP1 predicted that a process could leave Chive's process group. E7 confirmed
  the production impact with a normal controlled tool process.
- A reflected `dangerFullAccess` value shows that Codex accepted the requested
  inner sandbox setting. It is not, by itself, proof of the outer boundary;
  the sidecar and nono audit provide that separate evidence.
- E6 proves that a successful `turn/interrupt` response and interrupted turn
  status do not imply process cleanup. Both controlled processes survived.
- E7 proved that the current sidecar group does not own the controlled tool
  shell after it enters another group. Fallback cleanup is not a production
  lifecycle design.
- Claude Code Phase 5 and OpenCode Phase 6 passed their planned smoke depth.
  Their narrower coverage does not replace Codex's deeper E5–E7 checks.

## Retained evidence

- [Phase 0 tested stack](transcripts/phase0-inventory/run-20260727-001.md)
- [Phase 1 malformed JSON retention](transcripts/phase1-harness/malformed-json.run-20260727-002.md)
- [Phase 1 stderr drain](transcripts/phase1-harness/stderr-drain.run-20260727-003.md)
- [Phase 1 timeout cleanup](transcripts/phase1-harness/timeout-cleanup.run-20260727-004.md)
- [Phase 1 evidence redaction](transcripts/phase1-harness/redaction.run-20260727-005.md)
- [Phase 1 unrelated PID refusal](transcripts/phase1-harness/cleanup-refusal.run-20260727-006.md)
- [Phase 1 controlled workspace files](transcripts/phase1-harness/workspace-fixtures.run-20260727-007.md)
- [Phase 1 slow command lifecycle](transcripts/phase1-harness/slow-command-lifecycle.run-20260727-008.md)
- [E1 generated Codex surface](transcripts/phase2-codex-schema-handshake/e1-schema.run-20260731-025.md)
- [E2 initialization state machine](transcripts/phase2-codex-schema-handshake/e2-handshake.run-20260727-010.md)
- [E3 per-conversation settings](transcripts/phase3-codex-config-stream/e3-thread-config.run-20260727-011.md)
- [E4 final configuration-isolation verdict](transcripts/phase3-codex-config-stream/e4-config-isolation-final.run-20260727-013.md)
- [E5 inherited-config posture pre-check](transcripts/phase3-codex-config-stream/e5-config-posture.run-20260728-015.md)
- [E5 stream fidelity and same-thread reuse](transcripts/phase3-codex-config-stream/e5-stream.run-20260728-017.md)
- [E6 interruption during a tool call](transcripts/phase4-codex-interrupt-cleanup/e6-interrupt.run-20260728-019.md)
- [E7 runtime loss and outer cleanup](transcripts/phase4-codex-interrupt-cleanup/e7-lifecycle.run-20260730-020.md)
- [Phase 5 Claude Code smoke](transcripts/phase5-claude-smoke/phase5-claude-smoke.run-20260730-022.md)
- [Phase 6 OpenCode smoke](transcripts/phase6-opencode-smoke/phase6-opencode-smoke.run-20260730-023.md)

Codex E5–E7 used inherited user configuration and say so in their evidence.
Claude Code Phase 5 used the explicitly approved saved-login and open-network
posture. OpenCode Phase 6 used the explicitly approved saved-credential,
inherited-context, and open-network posture.
