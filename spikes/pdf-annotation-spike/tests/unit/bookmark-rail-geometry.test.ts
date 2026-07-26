import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bookmarkAnchorInsetForScale,
  bookmarkAnchorYForInset,
  bookmarkDestinationYForInset,
  bookmarkRailAnchorHeightPx,
  bookmarkRailAnchorWidthPx,
  bookmarkRailMarkerTranslateYPx,
  bookmarkRailRectsConflict,
  clampPdfY,
  offsetIntoPageForTargetY,
  railMarkerContentRectForOffset,
  railMarkerRectAt,
  renderedPageScale,
  targetYForOffsetIntoPage,
  withinSquareCue,
} from "../../src/lib/pdf/bookmark-rail-geometry";

describe("bookmark rail geometry", () => {
  it("builds marker rects with anchor dimensions and translate offset", () => {
    const rect = railMarkerRectAt(100, 50);
    assert.equal(rect.left, 100);
    assert.equal(rect.right, 100 + bookmarkRailAnchorWidthPx);
    assert.equal(rect.top, 50 + bookmarkRailMarkerTranslateYPx);
    assert.equal(rect.bottom, rect.top + bookmarkRailAnchorHeightPx);
  });

  it("builds marker content rects from a page position and offset", () => {
    const rect = railMarkerContentRectForOffset({ left: 20, top: 400 }, 30);
    assert.deepEqual(rect, railMarkerRectAt(20, 430));
  });

  it("flags conflicts inside the DMZ around an existing marker", () => {
    const marker = railMarkerRectAt(20, 400);
    const withinDmz = railMarkerRectAt(20, 400 + bookmarkRailAnchorHeightPx * 2 - 1);
    const belowDmz = railMarkerRectAt(20, 400 + bookmarkRailAnchorHeightPx * 3 + 1);
    assert.equal(bookmarkRailRectsConflict(withinDmz, marker), true);
    assert.equal(bookmarkRailRectsConflict(belowDmz, marker), false);
  });

  it("applies asymmetric horizontal DMZ tolerances", () => {
    const marker = railMarkerRectAt(100, 400);
    const justRight = railMarkerRectAt(marker.right + 8, 400);
    const tooFarRight = railMarkerRectAt(marker.right + 9, 400);
    const justLeft = railMarkerRectAt(marker.left - 28 - bookmarkRailAnchorWidthPx, 400);
    const tooFarLeft = railMarkerRectAt(marker.left - 29 - bookmarkRailAnchorWidthPx, 400);
    assert.equal(bookmarkRailRectsConflict(justRight, marker), true);
    assert.equal(bookmarkRailRectsConflict(tooFarRight, marker), false);
    assert.equal(bookmarkRailRectsConflict(justLeft, marker), true);
    assert.equal(bookmarkRailRectsConflict(tooFarLeft, marker), false);
  });

  it("clamps PDF Y coordinates to the page", () => {
    assert.equal(clampPdfY(-5, 792), 0);
    assert.equal(clampPdfY(800, 792), 792);
    assert.equal(clampPdfY(400, 792), 400);
  });

  it("falls back to scale 1 when the page has no rendered height", () => {
    assert.equal(renderedPageScale(0, 792), 1);
    assert.equal(renderedPageScale(1584, 792), 2);
  });

  it("round-trips offset-into-page and target Y at a given scale", () => {
    const pageHeight = 792;
    const renderedHeight = 1188;
    const scale = renderedPageScale(renderedHeight, pageHeight);
    const targetY = 512.25;
    const offset = offsetIntoPageForTargetY(targetY, pageHeight, renderedHeight);
    assert.ok(Math.abs(targetYForOffsetIntoPage(offset, scale, pageHeight) - targetY) < 1e-9);
  });

  it("round-trips destination Y and anchor Y through the same inset", () => {
    const pageHeight = 792;
    const inset = bookmarkAnchorInsetForScale(1.5);
    const targetY = 300;
    const destinationY = bookmarkDestinationYForInset(targetY, inset, pageHeight);
    assert.equal(bookmarkAnchorYForInset(destinationY, inset, pageHeight), targetY);
  });

  it("clamps destination Y at the top of the page", () => {
    const pageHeight = 792;
    const inset = bookmarkAnchorInsetForScale(1);
    assert.equal(bookmarkDestinationYForInset(pageHeight - 1, inset, pageHeight), pageHeight);
  });

  it("hit-tests square cues around a center point", () => {
    assert.equal(withinSquareCue(10, 10, 0, 0, 22), true);
    assert.equal(withinSquareCue(12, 0, 0, 0, 22), false);
    assert.equal(withinSquareCue(0, 12, 0, 0, 22), false);
  });
});
