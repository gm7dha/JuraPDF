import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { ShapeItem } from "../src/model/additions";
import { keptBox, marginsFor, marginsLabel, ownBox, trims } from "../src/model/trim";
import { addItems, changeItem } from "../src/pdf/additions";
import { keptIn } from "../src/pdf/items";
import { trimPages, untrimPages } from "../src/pdf/pages";

const STANDARD_FONTS = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;

/** Two 400 × 500 pages turned `turn`, each with "Here" written at (100, 300) in its own space. */
async function testPdf(turn = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([400, 500]);
    if (turn) page.setRotation(degrees(turn));
    page.drawText("Here", { x: 100, y: 300, size: 20, font });
  }
  return doc.save();
}

/** Page `n`'s size as shown and where "Here" starts on it (from the top-left as shown), by pdf.js. */
async function shown(bytes: Uint8Array, n = 1) {
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS, verbosity: 0 }).promise;
  const page = await doc.getPage(n);
  const view = page.getViewport({ scale: 1 });
  const item = (await page.getTextContent()).items.find((i) => "str" in i && i.str === "Here") as { transform: number[] };
  const m = Util.transform(view.transform, item.transform);
  await doc.destroy();
  return { width: Math.round(view.width), height: Math.round(view.height), x: Math.round(m[4]), y: Math.round(m[5]) };
}

describe("trimming, worked out", () => {
  it("turns a box into margins and back, refusing too small a page", () => {
    const m = marginsFor({ x: 20, y: 30, width: 300, height: 400 }, 400, 500);
    expect(m).toEqual({ left: 20, top: 30, right: 80, bottom: 70 });
    expect(keptBox(m, 400, 500)).toEqual({ x: 20, y: 30, width: 300, height: 400 });
    expect(keptBox(m, 120, 500)).toBeNull();
    expect(trims(m)).toBe(true);
    expect(trims({ left: 0, top: 0, right: 0, bottom: 0 })).toBe(false);
    expect(marginsLabel({ left: 72, top: 0, right: 0, bottom: 36 })).toBe("2.5 cm off the left, 1.3 cm off the bottom");
  });

  it("finds the box in the page's own space on turned pages", () => {
    const f = { x: 0, y: 0, width: 400, height: 500, rotation: 90 };
    // Turned 90° clockwise: shown 500 wide, 400 high. The shown top strip is the page's own left-hand strip.
    expect(ownBox(f, { x: 0, y: 0, width: 500, height: 100 }, 400)).toEqual({ x: 0, y: 0, width: 100, height: 500 });
  });
});

describe("trimming pages in the PDF", () => {
  for (const turn of [0, 90, 180, 270]) {
    it(`keeps what's on the page where it was, turned ${turn}`, async () => {
      const bytes = await testPdf(turn);
      const before = await shown(bytes);
      const m = { left: 10, top: 20, right: 30, bottom: 40 };
      const out = await trimPages(bytes, [0], m);
      expect(out.trimmed).toEqual([0]);
      const after = await shown(out.bytes);
      expect(after.width).toBe(before.width - 40);
      expect(after.height).toBe(before.height - 60);
      expect([after.x, after.y]).toEqual([before.x - 10, before.y - 20]);
      // Page 2 wasn't asked for.
      expect(await shown(out.bytes, 2)).toEqual(before);
      // Untrim brings it all back.
      const back = await untrimPages(out.bytes, [0, 1]);
      expect(back.untrimmed).toEqual([0]);
      expect(await shown(back.bytes)).toEqual(before);
    });
  }

  it("skips pages that would be left too small", async () => {
    const out = await trimPages(await testPdf(), [0, 1], { left: 200, top: 0, right: 180, bottom: 0 });
    expect(out.trimmed).toEqual([]);
    expect(out.skipped).toEqual([0, 1]);
  });

  it("moves JuraPDF's own additions with the page, so they can still be changed", async () => {
    for (const turn of [0, 90]) {
      const box: ShapeItem = { kind: "shape", shape: "box", page: 0, x1: 100, y1: 100, x2: 200, y2: 160, colour: "#d1373a", thickness: 2 };
      let bytes: Uint8Array = await addItems(await testPdf(turn), [box]);
      bytes = (await trimPages(bytes, [0], { left: 30, top: 50, right: 0, bottom: 0 })).bytes;
      const [kept] = (await keptIn(bytes))[0];
      expect(kept.item).toMatchObject({ x1: 70, y1: 50, x2: 170, y2: 110 });
      expect(kept.box.x).toBeCloseTo(kept.item.kind === "shape" ? 70 - 1 : 0, 0);
      // Changing it after the trim redraws it in the same place, not shifted.
      bytes = await changeItem(bytes, 0, kept.id, { ...(kept.item as ShapeItem), colour: "#000000" });
      expect((await keptIn(bytes))[0][0].item).toMatchObject({ x1: 70, y1: 50, colour: "#000000" });
      bytes = (await untrimPages(bytes, [0])).bytes;
      expect((await keptIn(bytes))[0][0].item).toMatchObject({ x1: 100, y1: 100 });
    }
  });
});
