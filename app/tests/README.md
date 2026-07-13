# Test foundation

Permanent regression layers:

- `npm run test:unit` runs Vitest over the pure lib modules in `tests/unit`.
- `npm run test:e2e` runs Playwright against the Vite browser app
  (port 1430 by default — see [Server ports](#server-ports-and-parallel-worktrees)).
- `npm run test:native` builds a debug Tauri app and runs WDIO against the native WKWebView.

`window.__pdfSpike` is a dev/test-only API exposed by `src/routes/+page.svelte`
(the name is kept from the reference implementation so its specs transplant
unchanged). Specs may use it to load fixtures, summarize annotations, and
perform stable editor actions without depending on PDF.js private DOM details
for every assertion.

Playwright owns browser regressions; WDIO owns native WKWebView smoke coverage.
The suites were transplanted from `../pdf-annotation-spike/tests` with
selector adaptations for the official UI (icon toolbar, dockable sidebar tabs,
rail-only bookmark creation, shared row palette, status live region).

## Frontend coverage

`npm run coverage` runs the unit suite and an instrumented Playwright browser
suite, then writes a merged terminal summary, `coverage/lcov.info`, and a
browsable report at `coverage/html/index.html`. It requires the same local
Playwright and `qpdf` prerequisites as `npm run test:e2e`. The coverage run
uses its own instrumented Vite server (port 1432 by default), so it can run
alongside a normal development server on port 1430.

## Server ports and parallel worktrees

Each server role has one port, with the default overridable per invocation
(`app/scripts/dev-ports.mjs` is the single source of truth):

| Port | Role | Override |
| --- | --- | --- |
| 1430 | Vite dev server; Playwright e2e `baseURL`/`webServer` | `CHIVE_E2E_PORT` |
| 1431 | Vite HMR WebSocket, bound only when `TAURI_DEV_HOST` is set | always e2e port + 1 |
| 1432 | Instrumented Vite server for `npm run coverage` | `CHIVE_COVERAGE_PORT` |

Vite keeps `strictPort: true`: a requested port that is occupied fails instead
of silently drifting to a neighbor. Invalid values (or an e2e/coverage/HMR
collision) fail at config load with the offending variable named.

Outside CI, `npm run test:e2e` reuses a server already listening on its port —
normally your running `npm run dev`. (Reuse probes `127.0.0.1`; if your
`localhost` resolves to IPv6 only, start the server with
`npm run dev -- --host 127.0.0.1` to make it reusable.) Before reusing,
Playwright's global setup
asks the server for its identity (`GET /__chive/identity`, a dev-server-only
endpoint) and aborts with the other checkout's path if the server was started
from a different worktree, instead of silently testing someone else's code.
Coverage and CI never reuse.

Parallel worktrees each get their own pair, set per invocation or exported
once per worktree (e.g. in `.envrc`):

```sh
# worktree A                            # worktree B
CHIVE_E2E_PORT=1440 npm run dev         CHIVE_E2E_PORT=1450 npm run dev
CHIVE_E2E_PORT=1440 npm run test:e2e    CHIVE_E2E_PORT=1450 npm run test:e2e
CHIVE_COVERAGE_PORT=1442 npm run coverage
```

Two caveats: `npm run tauri -- dev` ignores these variables — its port is
pinned to 1430 to stay in sync with `devUrl` in `tauri.conf.json` (making that
configurable is deferred; see issue #14). And parallel runs *within* one
worktree still share the working tree, build output, and report directories —
use one agent/run per worktree.

`npm run coverage:accept` reruns the same command and updates the tracked
`tests/coverage-baseline.json` ratchet after an intentional increase. The
baseline uses whole percentage points so normal browser execution variance
does not make the gate flaky. The coverage percentage covers app-owned
TypeScript and Svelte source, excluding
the test-only debug harness. Native WKWebView smoke remains a separate
behavior gate and does not contribute line-coverage counters.
