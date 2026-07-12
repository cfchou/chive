import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { pdfPathsFromArgs } from "../../src/lib/tauri/single-instance";

describe("single-instance launch arguments", () => {
  it("keeps only case-insensitive PDF paths and handles empty input", () => {
    assert.deepEqual(
      pdfPathsFromArgs(["/Applications/Chive", "--flag", "/tmp/readme.txt", "/tmp/alpha.PDF", "/tmp/beta.pdf"]),
      ["/tmp/alpha.PDF", "/tmp/beta.pdf"],
    );
    assert.deepEqual(pdfPathsFromArgs([]), []);
  });
});
