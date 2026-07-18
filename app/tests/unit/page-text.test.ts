import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { getPageTextItems } from "../../src/lib/pdf/page-text";

describe("pdf.js page text compatibility", () => {
  it("reads every streamed chunk without using the browser-only fallback", async () => {
    let fallbackCalls = 0;
    const chunks = [
      { items: [{ str: "first" }] },
      { items: [{ str: "second" }] },
    ];
    const items = await getPageTextItems({
      async getTextContent() {
        fallbackCalls += 1;
        return { items: [{ str: "fallback" }] };
      },
      streamTextContent() {
        return {
          getReader() {
            return {
              async read() {
                const value = chunks.shift();
                return value ? { done: false, value } : { done: true };
              },
            };
          },
        };
      },
    });

    assert.deepEqual(items, [{ str: "first" }, { str: "second" }]);
    assert.equal(fallbackCalls, 0);
  });

  it("uses getTextContent when streaming is unavailable", async () => {
    const items = await getPageTextItems({
      async getTextContent() {
        return { items: [{ str: "fallback" }] };
      },
    });

    assert.deepEqual(items, [{ str: "fallback" }]);
  });
});
