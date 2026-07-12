import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test as base } from "@playwright/test";

const coverageEnabled = process.env.VITE_COVERAGE === "true";
const coverageDirectory = path.resolve(process.cwd(), "coverage/e2e");

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page);

    if (!coverageEnabled || testInfo.status !== "passed") return;

    let coverage: unknown;
    try {
      coverage = await page.evaluate(() => (globalThis as typeof globalThis & { __coverage__?: unknown }).__coverage__);
    } catch (error) {
      throw new Error("Browser coverage collection failed.", { cause: error });
    }
    if (!coverage || typeof coverage !== "object") {
      throw new Error("Browser coverage is missing. Ensure VITE_COVERAGE starts an instrumented Vite server.");
    }

    await mkdir(coverageDirectory, { recursive: true });
    await writeFile(path.join(coverageDirectory, `${testInfo.testId}.json`), JSON.stringify(coverage));
  },
});

export { expect };
export type { Page } from "@playwright/test";
