import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writePdfOutlineState } from "../../src/lib/pdf/outline-byte-writer";

const latin1 = new TextDecoder("latin1");

describe("PDF outline byte writer", () => {
  it("writes Chive Bookmarks into PDF outline bytes with native color", async () => {
    const source = await readFile("static/sample.pdf");

    const written = writePdfOutlineState(new Uint8Array(source), {
      bookmarkRootTitle: "My Bookmarks",
      bookmarks: [
        {
          color: "#a855f7",
          destinationY: 512.25,
          pageRef: "6 0 R",
          title: "Purple bookmark",
        },
      ],
      documentOutlineEntries: [],
    });

    const text = latin1.decode(written);
    assert.match(text, /\/Title \(My Bookmarks\)/);
    assert.match(text, /\/Title \(Purple bookmark\)/);
    assert.match(text, /\/Dest \d+ 0 R/);
    assert.match(text, /\[ 6 0 R \/XYZ 0 512\.250 0 \]/);
    assert.match(text, /\/C \[0\.659 0\.333 0\.969\]/);
    assert.match(text, /\/Prev /);
    assert.match(text, /startxref/);
  });

  it("patches a dirty imported Document Outline Entry color without replacing its destination", async () => {
    const source = await readFile("static/colored-outline.pdf");

    const written = writePdfOutlineState(new Uint8Array(source), {
      bookmarkRootTitle: "My Bookmarks",
      bookmarks: [],
      documentOutlineEntries: [
        { color: "#a855f7", colorDirty: true, items: [] },
        { color: "#3b82f6", colorDirty: false, items: [] },
        { color: null, colorDirty: false, items: [] },
      ],
    });

    const redOutlineBody = lastObjectBody(latin1.decode(written), 7);
    assert.match(redOutlineBody, /\/Title \(Red Outline\)/);
    assert.match(redOutlineBody, /\/Dest \[3 0 R \/XYZ 0 792 0\]/);
    assert.match(redOutlineBody, /\/C \[0\.659 0\.333 0\.969\]/);
  });
});

function lastObjectBody(pdfText: string, objectNumber: number) {
  const matches = [
    ...pdfText.matchAll(new RegExp(`(?:^|\\n)${objectNumber}\\s+0\\s+obj\\s*([\\s\\S]*?)\\s*endobj`, "g")),
  ];
  const match = matches.at(-1);
  assert.ok(match, `expected object ${objectNumber}`);
  return match[1];
}
