import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import istanbul from "vite-plugin-istanbul";
import { resolvePorts } from "./scripts/dev-ports.mjs";

const host = process.env.TAURI_DEV_HOST;
const coverageEnabled = process.env.VITE_COVERAGE === "true";
const { e2ePort, hmrPort } = resolvePorts();

// Dev-server-only identity endpoint so a test run can verify that the server
// it is about to reuse serves *this* checkout, not another worktree's (issue #14).
const appRoot = realpathSync(path.dirname(fileURLToPath(import.meta.url)));
/** @returns {import("vite").Plugin} */
const identityPlugin = () => ({
  name: "chive-dev-identity",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__chive/identity", (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ app: "chive", root: appRoot }));
    });
  },
});

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    sveltekit(),
    identityPlugin(),
    ...(coverageEnabled
      ? [
          istanbul({
            cwd: process.cwd(),
            include: ["src/**/*.ts", "src/**/*.svelte"],
            exclude: ["src/lib/debug/**"],
            extension: [".ts", ".svelte"],
            requireEnv: true,
            checkProd: true,
          }),
        ]
      : []),
  ],

  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "istanbul",
      reportsDirectory: "coverage/unit",
      reporter: ["json"],
      include: ["src/**/*.ts"],
      exclude: ["src/lib/debug/**"],
      all: true,
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: e2ePort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
