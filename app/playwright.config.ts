import { defineConfig, devices } from "@playwright/test";
import { resolvePorts } from "./scripts/dev-ports.mjs";

type RetryEnvironment = { CI?: string; VITE_COVERAGE?: string };

export function resolvePlaywrightRetries(env: RetryEnvironment = process.env): number {
  return env.CI === "true" && env.VITE_COVERAGE === "true" ? 1 : 0;
}

const coverageEnabled = process.env.VITE_COVERAGE === "true";
const { e2ePort, coveragePort } = resolvePorts();
const port = coverageEnabled ? coveragePort : e2ePort;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  // Instrumentation makes PDF.js geometry timing occasionally miss once on
  // hosted runners; retry only that gate and capture its existing retry trace.
  retries: resolvePlaywrightRetries(),
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  // Refuses to run against a server that belongs to another worktree.
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !coverageEnabled,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
