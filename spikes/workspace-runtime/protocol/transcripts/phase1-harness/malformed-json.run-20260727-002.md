# Phase 1 — malformed JSON retention

- Run id: `run-20260727-002`
- Status: **PASS**
- Working directory: `<CHIVE_ROOT>`
- Expected: one invalid JSON stdout line remains visible as an explicit
  `unparsed` message.

## Operator command

```sh
python3 -B spikes/workspace-runtime/protocol/test_probe.py \
  JsonLineProcessTests.test_malformed_json_is_kept_as_an_unparsed_message
```

## Local child argv

```text
["<PYTHON>", "-u", "-c", "print(\"this is not json\", flush=True)"]
```

## Observed

- Test exit code: `0`
- Local child exit code: `0`
- Retained message: `{"unparsed": "this is not json"}`
- Result: the malformed line was not dropped and did not crash the parser.

Python initially reported that the finished child's stdout and stderr pipe
objects were not closed. The timeout-cleanup slice in `run-20260727-004` fixed
that shared cleanup path, and the three checks now pass together without the
warning.

Machine-readable evidence:
[`malformed-json.run-20260727-002.json`](malformed-json.run-20260727-002.json)
