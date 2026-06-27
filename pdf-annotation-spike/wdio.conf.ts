import type { Options } from "@wdio/types";

const appBinaryPath =
  process.env.TAURI_APP_BINARY ?? "./src-tauri/target/debug/pdf-annotation-spike";

export const config: Options.Testrunner = {
  runner: "local",
  specs: ["./tests/native/**/*.spec.ts"],
  maxInstances: 1,
  logLevel: "warn",
  bail: 0,
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        driverProvider: "embedded",
        captureBackendLogs: true,
        captureFrontendLogs: true,
        startTimeout: 120_000,
        statusPollTimeout: 10_000,
      },
    ],
  ],
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: appBinaryPath,
      },
    },
  ],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },
};
