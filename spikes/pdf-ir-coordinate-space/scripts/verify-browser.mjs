import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = normalize(join(fileURLToPath(import.meta.url), "../.."));
const runFile = promisify(execFile);
const viewportCases = [
  { name: "zoom-out", scale: 0.75 },
  { name: "baseline", scale: 1.35 },
  { name: "zoom-in", scale: 2 },
];
const mimeTypes = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".mjs", "text/javascript"],
  [".pdf", "application/pdf"],
]);

const server = createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const relative = requested === "/" ? "harness.html" : requested.slice(1);
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) throw new Error("Path leaves the proof directory");
    response.writeHead(200, { "content-type": mimeTypes.get(extname(file)) ?? "application/octet-stream" });
    response.end(await readFile(file));
  } catch (error) {
    console.error(`failed to serve ${request.url}: ${error}`);
    response.writeHead(404, { "content-type": "text/plain" });
    response.end(String(error));
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const fixtureProofs = JSON.parse(await readFile(join(root, "artifacts/boxes.json"), "utf8"));
if (!fixtureProofs.some((fixture) => fixture.name === "user-unit-2")) {
  throw new Error("missing user-unit-2 fixture");
}
for (const fixture of fixtureProofs) {
  await runFile("qpdf", ["--check", join(root, fixture.file)]);
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
page.on("console", (message) => console.error(`browser console: ${message.text()}`));
page.on("pageerror", (error) => console.error(`browser error: ${error.stack ?? error}`));
const summary = [];

try {
  for (const fixture of fixtureProofs) {
    for (const viewportCase of viewportCases) {
      const query = new URLSearchParams({
        fixture: fixture.name,
        scale: String(viewportCase.scale),
      });
      await page.goto(`${baseUrl}/harness.html?${query}`);
      await page.waitForFunction(() => window.coordinateProof);
      const result = await page.evaluate(() => window.coordinateProof);
      if (result.userUnit !== fixture.userUnit) {
        throw new Error(`${fixture.name}: expected /UserUnit ${fixture.userUnit}, got ${result.userUnit}`);
      }
      if (result.scale !== viewportCase.scale) {
        throw new Error(`${fixture.name}: expected scale ${viewportCase.scale}, got ${result.scale}`);
      }
      const pageBox = fixture.cropBox ?? fixture.mediaBox;
      const sourceWidth = pageBox[2] - pageBox[0];
      const sourceHeight = pageBox[3] - pageBox[1];
      const swapsAxes = fixture.pageRotation === 90 || fixture.pageRotation === 270;
      const expectedViewportSize = [
        (swapsAxes ? sourceHeight : sourceWidth) * fixture.userUnit * viewportCase.scale,
        (swapsAxes ? sourceWidth : sourceHeight) * fixture.userUnit * viewportCase.scale,
      ];
      if (
        !result.viewportSize ||
        result.viewportSize.some((value, index) => Math.abs(value - expectedViewportSize[index]) > 0.01)
      ) {
        throw new Error(
          `${fixture.name}: expected viewport ${expectedViewportSize}, got ${result.viewportSize}`,
        );
      }
      await page.locator("#page").screenshot({
        path: join(root, "artifacts", `${fixture.name}-${viewportCase.name}.png`),
      });
      summary.push({ ...result, zoom: viewportCase.name });
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

await writeFile(join(root, "artifacts/browser-proof.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`verified ${summary.length} coordinate cases through pdf.js`);
