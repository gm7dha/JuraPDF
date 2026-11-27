import { describe, expect, it } from "vitest";

import { MOST_SAVED, clearPaper, cleanSaved, dataUrlBytes, inkBounds, placingSize, withSaved } from "../src/model/signature";

/** A width × height drawing, see-through, with solid pixels where `ink` says. */
function drawing(width: number, height: number, ink: [number, number][]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of ink) px[(y * width + x) * 4 + 3] = 255;
  return px;
}

describe("signatures", () => {
  it("finds the ink in a drawing", () => {
    expect(inkBounds(drawing(10, 10, [[2, 3], [7, 5]]), 10, 10)).toEqual({ x: 2, y: 3, width: 6, height: 3 });
    expect(inkBounds(drawing(10, 10, []), 10, 10)).toBeNull();
  });

  it("makes white paper see-through and keeps the ink", () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 20, 20, 20, 255, 190, 190, 190, 255]);
    clearPaper(px);
    expect([px[3], px[7]]).toEqual([0, 255]);
    expect(px[11]).toBeGreaterThan(0);
    expect(px[11]).toBeLessThan(255);
  });

  it("starts signatures at a usual size", () => {
    expect(placingSize(800, 200).pixelsWide * 0.75).toBeCloseTo(160);
    // Tall ones are kept to 60 points high.
    const tall = placingSize(100, 100);
    expect(tall.pixelsHigh * 0.75).toBeCloseTo(60);
  });

  it("keeps a few, newest first, without repeats", () => {
    const sig = (n: number) => ({ id: `s${n}`, png: `data:image/png;base64,${btoa(String(n))}`, width: 10, height: 5 });
    let list = cleanSaved([sig(1), { id: "bad", png: "javascript:alert(1)", width: 1, height: 1 }, "junk"]);
    expect(list.map((s) => s.id)).toEqual(["s1"]);
    for (let n = 2; n <= 9; n++) list = withSaved(list, sig(n));
    expect(list.length).toBe(MOST_SAVED);
    expect(list[0].id).toBe("s9");
    expect(withSaved(list, { ...sig(9), id: "again" }).filter((s) => s.png === sig(9).png).length).toBe(1);
    expect(cleanSaved(null)).toEqual([]);
  });

  it("reads a data link's bytes", () => {
    expect([...dataUrlBytes("data:image/png;base64,AQID")]).toEqual([1, 2, 3]);
  });
});
