import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bookmarkPalette,
  colorNameForValue,
  freeTextColorNameForValue,
  hexToRgba,
  highlightColorNameForValue,
  highlightColors,
  inkColorNameForValue,
  normalizeOutlineColor,
  outlinePalette,
} from "../../src/lib/pdf/colors";

describe("PDF color helpers", () => {
  it("maps palette values back to color names case-insensitively", () => {
    assert.equal(highlightColorNameForValue("#fff35c"), "yellow");
    assert.equal(highlightColorNameForValue("#FFF35C"), "yellow");
    assert.equal(freeTextColorNameForValue("#2f6ecb"), "blue");
    assert.equal(inkColorNameForValue("#e32400"), "red");
  });

  it("returns null for unknown or missing colors", () => {
    assert.equal(highlightColorNameForValue(null), null);
    assert.equal(highlightColorNameForValue("#123456"), null);
    assert.equal(colorNameForValue(highlightColors, ""), null);
  });

  it("converts six-digit hex colors to rgba", () => {
    assert.equal(hexToRgba("#ff0000", 0.16), "rgba(255, 0, 0, 0.16)");
    assert.equal(hexToRgba("#0a0B0c", 1), "rgba(10, 11, 12, 1)");
  });

  it("falls back to transparent for malformed hex colors", () => {
    assert.equal(hexToRgba("#fff", 0.5), "transparent");
    assert.equal(hexToRgba("red", 0.5), "transparent");
  });

  it("normalizes outline RGB components to hex and rejects black/empty", () => {
    assert.equal(normalizeOutlineColor([240, 68, 68]), "#f04444");
    assert.equal(normalizeOutlineColor(new Uint8ClampedArray([0, 0, 0])), null);
    assert.equal(normalizeOutlineColor(undefined), null);
    assert.equal(normalizeOutlineColor([300, -5, 68]), "#ff0044");
  });

  it("keeps the bookmark palette as pink plus the colored outline options", () => {
    assert.equal(bookmarkPalette[0].name, "pink");
    assert.deepEqual(
      bookmarkPalette.slice(1),
      outlinePalette.filter((option) => option.color !== null),
    );
  });
});
