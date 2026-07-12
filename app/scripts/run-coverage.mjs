import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import coverageLib from "istanbul-lib-coverage";
import reportLib from "istanbul-lib-report";
import reports from "istanbul-reports";

const { createCoverageMap } = coverageLib;
const { createContext } = reportLib;

const root = process.cwd();
const coverageDirectory = path.join(root, "coverage");
const rawCoverageDirectories = {
  unit: path.join(coverageDirectory, "unit"),
  e2e: path.join(coverageDirectory, "e2e"),
};
const baselinePath = path.join(root, "tests", "coverage-baseline.json");
const acceptBaseline = process.argv.includes("--accept");
const metrics = ["lines", "statements", "functions", "branches"];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

function runNpmScript(script, args = [], env = process.env) {
  return run(npmCommand, ["run", script, "--", ...args], env);
}

async function jsonFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(directory, entry.name));
}

async function mergeCoverage() {
  const map = createCoverageMap({});
  for (const [suite, directory] of Object.entries(rawCoverageDirectories)) {
    const files = await jsonFiles(directory);
    if (files.length === 0) {
      throw new Error(
        `No ${suite === "e2e" ? "browser" : suite} coverage maps were collected. ${
          suite === "e2e" ? "Ensure VITE_COVERAGE starts an instrumented Vite server." : ""
        }`.trim(),
      );
    }
    for (const file of files) {
      map.merge(JSON.parse(await readFile(file, "utf8")));
    }
  }

  if (map.files().length === 0) {
    throw new Error("No coverage maps were collected.");
  }

  const context = createContext({ dir: coverageDirectory, coverageMap: map });
  reports.create("text").execute(context);
  reports.create("html", { subdir: "html" }).execute(context);
  reports.create("lcovonly", { file: "lcov.info" }).execute(context);
  reports.create("json-summary", { file: "coverage-summary.json" }).execute(context);
  await writeFile(path.join(coverageDirectory, "coverage-final.json"), JSON.stringify(map.toJSON()));
}

async function enforceBaseline() {
  const summary = JSON.parse(await readFile(path.join(coverageDirectory, "coverage-summary.json"), "utf8")).total;
  const current = Object.fromEntries(metrics.map((metric) => [metric, Math.floor(summary[metric].pct)]));

  if (acceptBaseline) {
    if (existsSync(baselinePath)) {
      const previous = JSON.parse(await readFile(baselinePath, "utf8"));
      const reductions = metrics.filter((metric) => current[metric] < previous[metric]);
      if (reductions.length > 0) {
        throw new Error(
          `Refusing to lower coverage baseline: ${reductions.map((metric) => `${metric} ${current[metric]}% < ${previous[metric]}%`).join(", ")}`,
        );
      }
    }
    await writeFile(`${baselinePath}`, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`Updated coverage baseline: ${path.relative(root, baselinePath)}`);
    return;
  }

  if (!existsSync(baselinePath)) {
    throw new Error("Coverage baseline is missing. Run npm run coverage:accept to capture the first green baseline.");
  }

  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const regressions = metrics.filter((metric) => current[metric] < baseline[metric]);
  if (regressions.length > 0) {
    throw new Error(
      `Coverage regressed: ${regressions.map((metric) => `${metric} ${current[metric]}% < ${baseline[metric]}%`).join(", ")}`,
    );
  }
}

await rm(coverageDirectory, { recursive: true, force: true });
await mkdir(coverageDirectory, { recursive: true });
await runNpmScript("test:unit", ["--coverage"]);
await runNpmScript("test:e2e", [], { ...process.env, VITE_COVERAGE: "true" });
await mergeCoverage();
await enforceBaseline();
