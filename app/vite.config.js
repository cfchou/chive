import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import istanbul from "vite-plugin-istanbul";

const host = process.env.TAURI_DEV_HOST;
const coverageEnabled = process.env.VITE_COVERAGE === "true";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    sveltekit(),
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
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1431,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
