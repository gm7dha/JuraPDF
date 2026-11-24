import { describe, expect, it } from "vitest";

import { NO_MARK, UNCONTROLLED_TEXT, hasMark, layoutMark, parsePageRange, ownText } from "../src/model/printMark";

// Roughly Helvetica: letters about 0.6 of their size wide (bold a little wider).
const measure = (text: string, size: number, bold: boolean) => text.length * size * (bold ? 0.66 : 0.56);

describe("print watermark", () => {
  it("is off unless something is chosen", () => {
    expect(hasMark(NO_MARK)).toBe(false);
    expect(hasMark({ uncontrolled: false, text: "   " })).toBe(false);
    expect(layoutMark(NO_MARK, 595, 842, measure)).toBeNull();
    expect(ownText({ uncontrolled: false, text: " W245354 " })).toBe("W245354");
  });

  it("writes UNCONTROLLED DOCUMENT corner to corner, rising to the right, within the page", () => {
    const [w, h] = [595, 842];
    const layout = layoutMark({ uncontrolled: true, text: "" }, w, h, measure)!;
    expect(layout.lines).toHaveLength(1);
    const line = layout.lines[0];
    expect(line.text).toBe(UNCONTROLLED_TEXT);
    expect(layout.angle).toBeCloseTo(-Math.atan2(h, w), 6);
    expect(line.x).toBeCloseTo(w / 2, 6);
    expect(line.y).toBeCloseTo(h / 2, 6);
    const length = measure(line.text, line.size, true);
    expect(length).toBeLessThanOrEqual(Math.hypot(w, h) * 0.75);
    expect(length).toBeGreaterThan(Math.hypot(w, h) * 0.5);
  });

  it("puts your own words under it, smaller, on the same slant", () => {
    const [w, h] = [842, 595];
    const layout = layoutMark({ uncontrolled: true, text: "Work Order W245354" }, w, h, measure)!;
    const [main, wo] = layout.lines;
    expect(wo.text).toBe("Work Order W245354");
    expect(wo.size).toBeLessThan(main.size);
    // "Under" across the slant: further down the page and to the right of the main line.
    expect(wo.y).toBeGreaterThan(main.y);
    expect(wo.x).toBeGreaterThan(main.x);
    // Together they're centred on the page.
    const mid = { x: (main.x * main.size + wo.x * wo.size) / (main.size + wo.size), y: (main.y * main.size + wo.y * wo.size) / (main.size + wo.size) };
    expect(Math.hypot(mid.x - w / 2, mid.y - h / 2)).toBeLessThan(main.size);
  });

  it("writes your own words on their own, large", () => {
    const layout = layoutMark({ uncontrolled: false, text: "42" }, 595, 842, measure)!;
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0].text).toBe("42");
    expect(layout.lines[0].bold).toBe(true);
  });

  it("keeps very long words on the page", () => {
    const wo = "X".repeat(60);
    const layout = layoutMark({ uncontrolled: true, text: wo }, 595, 842, measure)!;
    expect(measure(layout.lines[1].text, layout.lines[1].size, false)).toBeLessThanOrEqual(Math.hypot(595, 842) * 0.75);
  });
});

describe("pages to print", () => {
  it("reads page numbers and ranges", () => {
    expect(parsePageRange("", 4)).toEqual({ pages: [1, 2, 3, 4] });
    expect(parsePageRange("All", 2)).toEqual({ pages: [1, 2] });
    expect(parsePageRange("1-3, 5", 9)).toEqual({ pages: [1, 2, 3, 5] });
    expect(parsePageRange("5, 1 - 2, 2", 9)).toEqual({ pages: [1, 2, 5] });
    expect(parsePageRange("8-", 10)).toEqual({ pages: [8, 9, 10] });
    expect(parsePageRange("-2", 10)).toEqual({ pages: [1, 2] });
    expect(parsePageRange("3-20", 5)).toEqual({ pages: [3, 4, 5] });
  });

  it("explains what's wrong", () => {
    expect(parsePageRange("12", 10)).toEqual({ error: "There's no page 12. This PDF has 10 pages." });
    expect(parsePageRange("4-2", 10)).toEqual({ error: '"4-2" goes backwards. Try 2-4.' });
    expect(parsePageRange("two", 10)).toEqual({ error: '"two" isn\'t a page number. Type pages like 1-3, 5.' });
    expect(parsePageRange("0", 1)).toEqual({ error: "There's no page 0. This PDF has 1 page." });
  });
});
