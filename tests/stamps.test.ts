import { describe, expect, it } from "vitest";

import { additionLabel } from "../src/model/additions";
import { cleanStamp, DEFAULT_STAMP, STAMPS, stampDate, stampLines, stampPlacingSize } from "../src/model/stamps";

describe("stamps", () => {
  it("has ready-made stamps in capitals", () => {
    expect(STAMPS.length).toBeGreaterThan(8);
    for (const s of STAMPS) expect(s.words).toBe(s.words.toUpperCase());
  });

  it("writes the words and the line under them", () => {
    const now = new Date(2026, 10, 27);
    expect(stampDate(now)).toBe("27 Nov 2026");
    expect(stampLines({ words: "  approved  by qa ", colour: "#000000", date: true, name: " Kevin " }, now)).toEqual({ main: "APPROVED BY QA", sub: "Kevin · 27 Nov 2026" });
    expect(stampLines({ ...DEFAULT_STAMP, date: false }, now)).toEqual({ main: "APPROVED", sub: "" });
  });

  it("tidies remembered settings", () => {
    expect(cleanStamp(null)).toEqual(DEFAULT_STAMP);
    expect(cleanStamp({ words: "VOID", colour: "red", date: "yes", name: 3 })).toEqual({ ...DEFAULT_STAMP, words: "VOID" });
    expect(cleanStamp({ words: "", colour: "#123456", date: false, name: "Sam" })).toEqual({ words: "APPROVED", colour: "#123456", date: false, name: "Sam" });
  });

  it("starts 40 points tall, or 220 wide for long ones", () => {
    expect(stampPlacingSize(400, 100)).toEqual({ pixelsWide: (160 / 0.75), pixelsHigh: 40 / 0.75 });
    const long = stampPlacingSize(2000, 100);
    expect(long.pixelsWide * 0.75).toBeCloseTo(220);
  });

  it("is called a stamp in Undo", () => {
    expect(additionLabel({ kind: "picture", page: 2, x: 0, y: 0, width: 10, height: 10, stamp: "APPROVED" })).toBe("stamp “APPROVED” on page 3");
  });
});
