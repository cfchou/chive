# Phase 1 — evidence redaction

- Run id: `run-20260727-005`
- Status: **PASS**
- Working directory: `<CHIVE_ROOT>`
- Expected: synthetic private values become stable placeholders while harmless
  runtime fields remain unchanged.

## Operator command

```sh
python3 -B spikes/workspace-runtime/protocol/test_probe.py \
  RedactionTests.test_private_values_are_replaced_with_stable_placeholders
```

## Synthetic inputs

The test creates fake values at runtime for these categories:

- email address;
- token with an `sk-` shape;
- path below the current home directory;
- configured MCP server name in text and structured protocol data;
- hostname following `ENOTFOUND`.

The fake email and token are assembled from harmless pieces so repository
secret scans do not mistake the test source for real private data.

## Observed

| Input category | Retained value |
| --- | --- |
| Email | `<REDACTED_EMAIL>` |
| Token | `<REDACTED_TOKEN>` |
| Home directory | `<HOME>` |
| MCP server | `<MCP_SERVER>` |
| Private hostname | `<REDACTED_HOST>` |

The harmless runtime, status, and count fields stayed unchanged. The focused
test exited with code 0. No `redact()` implementation change was needed.

No model or network connection was used.

Machine-readable evidence:
[`redaction.run-20260727-005.json`](redaction.run-20260727-005.json)
