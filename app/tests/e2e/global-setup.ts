import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test";

// Playwright starts (or reuses) the webServer before running globalSetup, so by
// the time this runs a server answers at baseURL. reuseExistingServer accepts
// *anything* listening on the port; this check rejects a server that serves a
// different checkout — e.g. another worktree's dev server (issue #14).
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) throw new Error("playwright.config.ts must set use.baseURL.");

  const appRoot = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
  const identityURL = new URL("/__chive/identity", baseURL).href;
  const remedy =
    "Stop whatever is listening there, or give this run its own server with e.g. " +
    "CHIVE_E2E_PORT=1440 npm run test:e2e.";

  let identity: { app?: unknown; root?: unknown };
  try {
    const response = await fetch(identityURL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    identity = await response.json();
  } catch (error) {
    throw new Error(
      `The server at ${baseURL} did not answer the chive identity check (${identityURL}), ` +
        `so it does not look like a chive dev server. ${remedy}`,
      { cause: error },
    );
  }

  if (identity.app !== "chive" || typeof identity.root !== "string") {
    throw new Error(
      `The server at ${baseURL} returned an unexpected identity (${JSON.stringify(identity)}). ${remedy}`,
    );
  }
  if (identity.root !== appRoot) {
    throw new Error(
      `The server at ${baseURL} serves another checkout:\n` +
        `  server: ${identity.root}\n` +
        `  tests:  ${appRoot}\n${remedy}`,
    );
  }
}
