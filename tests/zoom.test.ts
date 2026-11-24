import { describe, expect, it } from "vitest";

import {
  CSS_PER_PT,
  MAX_ZOOM,
  wheelFlip,
  MIN_ZOOM,
  PAGE_GAP,
  PAGE_MARGIN_X,
  PAGE_MARGIN_Y,
  currentPageAt,
  fitPageZoom,
  fitWidthZoom,
  keepSpotInView,
  layoutPages,
  parsePageNumber,
  parseZoom,
  resolveZoom,
  zoomIn,
  zoomLabel,
  zoomOut,
  type Size,
} from "../src/model/zoom";

const A4: Size = [595.28, 841.89];

describe("zoom", () => {
  it("fits the widest page to the window's width", () => {
    const view: Size = [1000, 700];
    const z = fitWidthZoom([A4, [842, 595]], view);
    expect(842 * CSS_PER_PT * z).toBeCloseTo(1000 - 2 * PAGE_MARGIN_X, 5);
  });

  it("fits a whole page in the window", () => {
    const view: Size = [1400, 700];
    const z = fitPageZoom([A4], view);
    // Height is what limits it here.
    expect(A4[1] * CSS_PER_PT * z).toBeCloseTo(700 - 2 * PAGE_MARGIN_Y, 5);
    expect(A4[0] * CSS_PER_PT * z).toBeLessThan(1400);
  });

  it("keeps fixed zooms within limits", () => {
    expect(resolveZoom(1.5, [A4], [800, 600])).toBe(1.5);
    expect(resolveZoom(100, [A4], [800, 600])).toBe(MAX_ZOOM);
    expect(resolveZoom(0.001, [A4], [800, 600])).toBe(MIN_ZOOM);
    expect(resolveZoom("width", [A4], [10, 10])).toBe(MIN_ZOOM);
  });

  it("steps in and out through the usual levels", () => {
    expect(zoomIn(1)).toBe(1.1);
    expect(zoomOut(1)).toBe(0.9);
    expect(zoomIn(1.03)).toBe(1.1);
    expect(zoomOut(1.03)).toBe(1);
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
  });

  it("reads typed zooms", () => {
    expect(parseZoom("150%")).toBe(1.5);
    expect(parseZoom(" 75 ")).toBe(0.75);
    expect(parseZoom("2x")).toBe(2);
    expect(parseZoom("9000")).toBe(MAX_ZOOM);
    expect(parseZoom("big")).toBeNull();
    expect(zoomLabel(1.249)).toBe("125%");
  });

  it("reads typed page numbers", () => {
    expect(parsePageNumber("3", 10)).toBe(3);
    expect(parsePageNumber("0", 10)).toBe(1);
    expect(parsePageNumber("99", 10)).toBe(10);
    expect(parsePageNumber("2.5", 10)).toBeNull();
    expect(parsePageNumber("", 10)).toBeNull();
    expect(parsePageNumber("abc", 10)).toBeNull();
  });
});

describe("page layout", () => {
  it("stacks the pages with gaps between", () => {
    const { boxes, height } = layoutPages([A4, A4, [842, 595]], 1);
    expect(boxes[0].top).toBe(PAGE_MARGIN_Y);
    expect(boxes[1].top).toBe(boxes[0].top + boxes[0].height + PAGE_GAP);
    expect(boxes[2].width).toBe(Math.round(842 * CSS_PER_PT));
    expect(height).toBe(boxes[2].top + boxes[2].height + PAGE_MARGIN_Y);
  });

  it("knows which page is being read", () => {
    const { boxes } = layoutPages([A4, A4, A4], 1);
    expect(currentPageAt(boxes, 0, 600)).toBe(0);
    // Scrolled so page 2 fills most of the window.
    expect(currentPageAt(boxes, boxes[1].top + 50, 600)).toBe(1);
    // Right at the end.
    expect(currentPageAt(boxes, boxes[2].top + boxes[2].height - 300, 600)).toBe(2);
  });

  it("keeps the same spot in view when zooming", () => {
    const pages = [A4, A4, A4];
    const before = layoutPages(pages, 1).boxes;
    const after = layoutPages(pages, 2).boxes;
    // Halfway down page 2, at the top of the window.
    const scrollTop = before[1].top + before[1].height / 2;
    const top = keepSpotInView(before, after, scrollTop, 0);
    expect(top).toBeCloseTo(after[1].top + after[1].height / 2, 5);
    // Under the pointer, 200 px down the window.
    const top2 = keepSpotInView(before, after, scrollTop - 200, 200);
    expect(top2 + 200).toBeCloseTo(after[1].top + after[1].height / 2, 5);
  });
});

describe("one page at a time: the wheel flips pages", () => {
  it("flips once the wheel has turned far enough", () => {
    let r = wheelFlip(0, 50, false);
    expect(r).toEqual({ total: 50, flip: 0 });
    r = wheelFlip(r.total, 50, false);
    expect(r).toEqual({ total: 0, flip: 1 });
    expect(wheelFlip(0, -120, false)).toEqual({ total: 0, flip: -1 });
  });
  it("starts again when the wheel turns the other way", () => {
    expect(wheelFlip(60, -30, false)).toEqual({ total: -30, flip: 0 });
  });
  it("scrolls the page instead while it can", () => {
    expect(wheelFlip(60, 100, true)).toEqual({ total: 0, flip: 0 });
  });
});
