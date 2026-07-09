import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pdfPathsFromSecondInstanceArgs } from "../../src/lib/tauri/single-instance";

describe("Tauri single-instance launch arguments", () => {
  it("keeps only PDF paths from second-launch argv", () => {
    assert.deepEqual(
      pdfPathsFromSecondInstanceArgs([
        "/Applications/Chive.app/Contents/MacOS/chive",
        "--flag",
        "/tmp/readme.txt",
        "/tmp/alpha.PDF",
        "/tmp/beta.pdf",
      ]),
      ["/tmp/alpha.PDF", "/tmp/beta.pdf"],
    );
  });
});
