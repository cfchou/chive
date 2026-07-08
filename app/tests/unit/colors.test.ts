import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  annotationColorNameForValue,
  annotationPalette,
  bookmarkPalette,
  colorNameForValue,
  defaultHeaderColorNames,
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
    assert.equal(freeTextColorNameForValue("#3280dd"), "blue");
    assert.equal(inkColorNameForValue("#d73337"), "red");
  });

  it("keeps the spike highlight pastels for yellow/green/blue/rose", () => {
    assert.equal(highlightColors.yellow, "#fff35c");
    assert.equal(highlightColors.green, "#7cf2aa");
    assert.equal(highlightColors.blue, "#8ecbff");
    assert.equal(highlightColors.rose, "#ffb6de");
  });

  it("resolves annotation color names from either palette column", () => {
    assert.equal(annotationColorNameForValue("#f2cf3b"), "yellow");
    assert.equal(annotationColorNameForValue("#fff35c"), "yellow");
    assert.equal(annotationColorNameForValue("#8ecbff"), "blue");
    assert.equal(annotationColorNameForValue("#123456"), null);
  });

  it("exposes eight plate colors and five header slots from the plate", () => {
    assert.equal(annotationPalette.length, 8);
    assert.deepEqual(
      annotationPalette.map((entry) => entry.name),
      ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "rose"],
    );
    assert.deepEqual(defaultHeaderColorNames, ["red", "yellow", "green", "blue", "purple"]);
    for (const name of defaultHeaderColorNames) {
      assert.ok(annotationPalette.some((entry) => entry.name === name));
    }
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

  it("shares one row palette between bookmarks and outline (no-color + 5 tints)", () => {
    assert.equal(bookmarkPalette, outlinePalette);
    assert.deepEqual(
      outlinePalette.map((option) => option.name),
      ["default", "red", "orange", "yellow", "blue", "purple"],
    );
    assert.equal(outlinePalette[0].color, null);
  });
});
