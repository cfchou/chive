# E1 — Codex generated protocol surface

- Run id: `run-20260731-025`
- Status: **PASS**
- Working directory: `<CHIVE_ROOT>`
- Expected: generate stable and experimental schemas from the frozen Codex
  executable, then confirm the stable requests and fields needed by Chive.

## Operator command

```sh
PYTHONPYCACHEPREFIX=/tmp/chive-sp2-pycache \
  python3 spikes/workspace-runtime/protocol/probe.py schema \
  --out spikes/workspace-runtime/protocol/transcripts/phase2-codex-schema-handshake/e1-schema.run-20260731-025.json
```

## Codex child argv

```text
["<HOME>/.local/bin/codex", "--version"]
["<HOME>/.local/bin/codex", "app-server", "generate-json-schema", "--out", "<WORKSPACE>/stable"]
["<HOME>/.local/bin/codex", "app-server", "generate-json-schema", "--experimental", "--out", "<WORKSPACE>/experimental"]
```

## Observed

| Field | Stable | Experimental |
| --- | ---: | ---: |
| Generated files | 273 | 347 |
| Canonical V2 JSON SHA-256 | `27f8d983f19d8e1a5548d52176de0a460fb05aaf2a72110f913c6f4af2bd4f27` | `62869ce8ab6c5df3f36ffc658cd2a43d153512b6b0da3d488dd17e28ea25a7f6` |

Codex identity:

- Version: `0.145.0`
- Executable SHA-256:
  `1da3f4e0e96028b8a771814293c3033dafd1971f943f6c7e79b0897fe705f590`

Required stable request methods:

| Method | Present |
| --- | --- |
| `initialize` | yes |
| `account/read` | yes |
| `thread/start` | yes |
| `turn/start` | yes |
| `turn/interrupt` | yes |

The generated client-notification schema also contains `initialized`.

Required stable fields:

| Request | Field | Generated shape |
| --- | --- | --- |
| `thread/start` | `cwd` | optional string or null |
| `thread/start` | `sandbox` | optional `SandboxMode` or null |
| `thread/start` | `approvalPolicy` | optional `AskForApproval` or null |
| `turn/start` | `input` | required array of `UserInput` |
| `turn/interrupt` | `threadId` | required string |
| `turn/interrupt` | `turnId` | required string |

Each command exited with code 0 and reported one diagnostic line. The evidence
keeps the line counts but not raw stdout or stderr.

Codex can write JSON object keys in a different order on each schema
generation. The probe sorts object keys before hashing, so the recorded hashes
compare schema meaning instead of incidental key order. A second fresh
generation produced the same two canonical hashes.

Generated schema directories were temporary and were deleted after the
summary was written. No auth check, model turn, or network request ran.

Machine-readable evidence:
[`e1-schema.run-20260731-025.json`](e1-schema.run-20260731-025.json)
