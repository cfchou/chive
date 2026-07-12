import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  parseSidebarWidths,
  resizedSidebarWidth,
  serializeSidebarWidths,
} from "../../src/lib/ui/sidebar-resize";

describe("sidebar-resize", () => {
  it("clamps widths into the allowed range", () => {
    assert.equal(clampSidebarWidth(SIDEBAR_MIN_WIDTH - 100), SIDEBAR_MIN_WIDTH);
    assert.equal(clampSidebarWidth(SIDEBAR_MAX_WIDTH + 100), SIDEBAR_MAX_WIDTH);
    assert.equal(clampSidebarWidth(400), 400);
    assert.equal(clampSidebarWidth(Number.NaN), SIDEBAR_DEFAULT_WIDTH);
  });

  it("left sidebar grows as the pointer moves right", () => {
    assert.equal(resizedSidebarWidth("left", 367, 367, 427), 427);
    assert.equal(resizedSidebarWidth("left", 367, 367, 307), 307);
  });

  it("right sidebar grows as the pointer moves left", () => {
    assert.equal(resizedSidebarWidth("right", 367, 900, 840), 427);
    assert.equal(resizedSidebarWidth("right", 367, 900, 960), 307);
  });

  it("resized widths are clamped at both ends", () => {
    assert.equal(resizedSidebarWidth("left", 367, 367, 5000), SIDEBAR_MAX_WIDTH);
    assert.equal(resizedSidebarWidth("left", 367, 367, -5000), SIDEBAR_MIN_WIDTH);
  });

  it("serializes and parses widths round-trip", () => {
    const widths = { left: 320, right: 480 };
    assert.deepEqual(parseSidebarWidths(serializeSidebarWidths(widths)), widths);
  });

  it("parses garbage input to defaults and clamps out-of-range values", () => {
    const defaults = { left: SIDEBAR_DEFAULT_WIDTH, right: SIDEBAR_DEFAULT_WIDTH };
    assert.deepEqual(parseSidebarWidths(null), defaults);
    assert.deepEqual(parseSidebarWidths(""), defaults);
    assert.deepEqual(parseSidebarWidths("not json"), defaults);
    assert.deepEqual(parseSidebarWidths('{"left":"x"}'), defaults);
    assert.deepEqual(parseSidebarWidths('{"left":1,"right":99999}'), {
      left: SIDEBAR_MIN_WIDTH,
      right: SIDEBAR_MAX_WIDTH,
    });
  });
});
