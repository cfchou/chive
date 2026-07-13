// Single source of truth for the browser dev/test server ports (issue #14).
// Consumed by vite.config.js, playwright.config.ts, and the unit tests, so
// every entry point agrees on defaults and validation.

export const DEFAULT_E2E_PORT = 1430;
export const DEFAULT_COVERAGE_PORT = 1432;

// HMR binds e2ePort + 1, so the upper bound leaves room for it.
const MIN_PORT = 1024;
const MAX_PORT = 65534;

/**
 * @param {string} name environment variable name, for error messages
 * @param {string | undefined} raw raw environment value
 * @param {number} fallback port to use when the variable is unset
 * @returns {number}
 */
function parsePort(name, raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(
      `${name}=${raw} is not a usable port. Use an integer between ${MIN_PORT} and ${MAX_PORT} ` +
        `(the next port up is reserved for HMR), e.g. ${name}=1440 npm run test:e2e.`,
    );
  }
  return port;
}

/**
 * Resolve the browser-server ports from the environment.
 *
 * - `CHIVE_E2E_PORT` — `npm run dev` and ordinary `npm run test:e2e` (default 1430)
 * - `CHIVE_COVERAGE_PORT` — the instrumented server behind `npm run coverage` (default 1432)
 * - HMR (only bound when `TAURI_DEV_HOST` is set) — always the e2e port + 1
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ e2ePort: number, coveragePort: number, hmrPort: number }}
 */
export function resolvePorts(env = process.env) {
  const e2ePort = parsePort("CHIVE_E2E_PORT", env.CHIVE_E2E_PORT, DEFAULT_E2E_PORT);
  const coveragePort = parsePort("CHIVE_COVERAGE_PORT", env.CHIVE_COVERAGE_PORT, DEFAULT_COVERAGE_PORT);
  const hmrPort = e2ePort + 1;
  if (coveragePort === e2ePort || coveragePort === hmrPort) {
    throw new Error(
      `CHIVE_COVERAGE_PORT=${coveragePort} collides with ` +
        (coveragePort === e2ePort
          ? `CHIVE_E2E_PORT=${e2ePort}`
          : `the HMR port ${hmrPort} (CHIVE_E2E_PORT + 1)`) +
        ". Coverage must keep its own server, e.g. CHIVE_E2E_PORT=1440 CHIVE_COVERAGE_PORT=1442.",
    );
  }
  return { e2ePort, coveragePort, hmrPort };
}
