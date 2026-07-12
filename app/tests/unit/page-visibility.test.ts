import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { isPageInView } from "../../src/lib/pdf/page-visibility";

const rectSource = (top: number, bottom: number) => ({
  getBoundingClientRect: () => ({ top, bottom }),
});

const container = rectSource(0, 600);

describe("page visibility", () => {
  it("reports a page intersecting the container's vertical band as in view", () => {
    assert.equal(isPageInView(container, rectSource(100, 500)), true, "fully inside");
    assert.equal(isPageInView(container, rectSource(-200, 100)), true, "straddles container top");
    assert.equal(isPageInView(container, rectSource(550, 1200)), true, "straddles container bottom");
    assert.equal(isPageInView(container, rectSource(-100, 900)), true, "covers the whole container");
  });

  it("reports a page outside the container's vertical band as out of view", () => {
    assert.equal(isPageInView(container, rectSource(700, 1300)), false, "below the container");
    assert.equal(isPageInView(container, rectSource(-500, -50)), false, "above the container");
  });

  it("treats a page merely touching the band edge as out of view", () => {
    assert.equal(isPageInView(container, rectSource(600, 1200)), false, "flush against the bottom");
    assert.equal(isPageInView(container, rectSource(-400, 0)), false, "flush against the top");
  });

  it("ignores horizontal position entirely", () => {
    const wideContainer = { getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, right: 400 }) };
    const pageOffscreenRight = { getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 1000, right: 1600 }) };
    assert.equal(isPageInView(wideContainer, pageOffscreenRight), true);
  });
});
