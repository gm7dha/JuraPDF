import { describe, expect, it } from "vitest";

import { DEFAULT_SIDE_WIDTH, MIN_SIDE_WIDTH, clampSideWidth, readSideWidths, thumbLayout, thumbWidthFor } from "../src/model/sidePanel";

describe("side panel width", () => {
  it("stays between the smallest and most of the window", () => {
    expect(clampSideWidth(300, 1400)).toBe(300);
    expect(clampSideWidth(20, 1400)).toBe(MIN_SIDE_WIDTH);
    expect(clampSideWidth(1200, 1400)).toBe(720);
    expect(clampSideWidth(700, 800)).toBe(480);
    expect(clampSideWidth(500, 100)).toBe(MIN_SIDE_WIDTH);
    expect(clampSideWidth(NaN, 1400)).toBe(MIN_SIDE_WIDTH);
  });

  it("grows the page pictures with the panel", () => {
    expect(thumbWidthFor(168)).toBe(120);
    expect(thumbWidthFor(400)).toBe(352);
    expect(thumbWidthFor(100)).toBe(80);
  });

  it("reads remembered widths kindly", () => {
    expect(readSideWidths(null)).toEqual(DEFAULT_SIDE_WIDTH);
    expect(readSideWidths("not json")).toEqual(DEFAULT_SIDE_WIDTH);
    expect(readSideWidths('{"pages":300,"bookmarks":"wide"}')).toEqual({ pages: 300, bookmarks: 250, notes: 260, changes: 280 });
    expect(readSideWidths('{"pages":5,"bookmarks":5000}')).toEqual({ pages: MIN_SIDE_WIDTH, bookmarks: 720, notes: 260, changes: 280 });
  });
});

describe("page list layout", () => {
  it("stacks the pictures with room for their numbers", () => {
    const { boxes, height } = thumbLayout(
      [
        [595, 842],
        [842, 595],
      ],
      120,
    );
    expect(boxes).toEqual([
      { top: 12, height: 170 + 34 },
      { top: 12 + 204 + 4, height: 85 + 34 },
    ]);
    expect(height).toBe(12 + 204 + 4 + 119 + 12);
    expect(thumbLayout([], 120).height).toBe(24);
  });
});
