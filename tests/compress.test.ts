import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from "pdf-lib";
import { deflateSync } from "node:zlib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { fromRgba, hasCameraNotes, longestSideFor, savingLabel, shrunkSize, SQUEEZES, toRgba, undoPredictor } from "../src/model/compress";
import { sizeLabel } from "../src/model/pdfFile";
import { dropUnused, squeeze, type Painter, type Picture } from "../src/pdf/compress";

describe("making smaller (pure)", () => {
  it("works out how big pictures need to be", () => {
    expect(longestSideFor([[595, 842], [842, 595]], 150)).toBe(1755);
    expect(longestSideFor([], 72)).toBe(842);
    expect(shrunkSize(1000, 500, 900)).toBeNull();
    expect(shrunkSize(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 });
    expect(SQUEEZES.strong.dpi).toBeLessThan(SQUEEZES.medium.dpi);
  });

  it("undoes PNG predictors of every kind", () => {
    // Two rows of three grey pixels: 10 20 30 / 15 25 40.
    const rows = [
      [10, 20, 30],
      [15, 25, 40],
    ];
    const encode = (kind: number) => {
      const out: number[] = [];
      rows.forEach((row, r) => {
        out.push(kind);
        row.forEach((v, i) => {
          const left = i ? row[i - 1] : 0;
          const up = r ? rows[r - 1][i] : 0;
          const ul = r && i ? rows[r - 1][i - 1] : 0;
          const p = left + up - ul;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - ul);
          const pred = [0, left, up, (left + up) >> 1, pa <= pb && pa <= pc ? left : pb <= pc ? up : ul][kind];
          out.push((v - pred + 256) & 255);
        });
      });
      return new Uint8Array(out);
    };
    for (const kind of [0, 1, 2, 3, 4]) expect(Array.from(undoPredictor(encode(kind), 3, 1, 8)!)).toEqual([10, 20, 30, 15, 25, 40]);
    expect(undoPredictor(new Uint8Array([9, 1, 2, 3]), 3, 1, 8)).toBeNull();
    expect(undoPredictor(new Uint8Array([]), 3, 1, 8)).toBeNull();
  });

  it("turns stored pixels into red, green, blue, alpha and back", () => {
    expect(Array.from(toRgba(new Uint8Array([7, 9]), 1, 2, 1)!)).toEqual([7, 7, 7, 255, 9, 9, 9, 255]);
    expect(Array.from(toRgba(new Uint8Array([1]), 1, 1, 1, new Uint8Array([0, 0, 0, 5, 6, 7]))!)).toEqual([5, 6, 7, 255]);
    expect(toRgba(new Uint8Array([1, 2]), 3, 1, 1)).toBeNull();
    const rgba = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    expect(Array.from(fromRgba(rgba, false))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(fromRgba(rgba, true))).toEqual([1, 4]);
  });

  it("spots JPGs with camera notes", () => {
    const exif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0, 0xff, 0xda, 0, 2]);
    expect(hasCameraNotes(exif)).toBe(true);
    expect(hasCameraNotes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xda, 0, 2, 0x45, 0x78, 0x69, 0x66]))).toBe(false);
  });

  it("says how much was saved", () => {
    expect(savingLabel(4 * 1024 * 1024, 1024 * 1024, sizeLabel)).toBe("4.0 MB → 1.0 MB (75% smaller)");
    expect(savingLabel(1000, 1000, sizeLabel)).toMatch(/already as small/);
  });
});

/** Draws pictures the simple way (nearest pixel); "JPGs" are just a few bytes standing in for one. */
const painter: Painter = {
  async pixels(p: Picture, width, height) {
    if (p.kind !== "pixels") throw new Error("can't read JPGs here");
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const sx = Math.floor((x * p.width) / width);
        const sy = Math.floor((y * p.height) / height);
        out.set(p.rgba.subarray((sy * p.width + sx) * 4, (sy * p.width + sx) * 4 + 4), (y * width + x) * 4);
      }
    return out;
  },
  async jpg() {
    return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  },
};

/** A 400 × 600 point page showing a 2000 × 1500 picture (far more than it needs), plus a leftover nothing uses. */
async function bigPicture(gray = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const [w, h] = [2000, 1500];
  const ch = gray ? 1 : 3;
  const px = new Uint8Array(w * h * ch);
  // Not too even, so it doesn't squeeze to nothing as it is.
  let seed = 7;
  for (let i = 0; i < px.length; i++) px[i] = ((i % 251) + ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 40)) & 255;
  const image = doc.context.register(
    PDFRawStream.of(
      doc.context.obj({ Type: "XObject", Subtype: "Image", Width: w, Height: h, BitsPerComponent: 8, ColorSpace: gray ? "DeviceGray" : "DeviceRGB", Filter: "FlateDecode" }),
      deflateSync(px),
    ),
  );
  page.node.setXObject(PDFName.of("Im1"), image);
  page.pushOperators(...[]);
  const content = doc.context.register(doc.context.flateStream("q 400 0 0 300 0 150 cm /Im1 Do Q"));
  page.node.set(PDFName.of("Contents"), content);
  doc.context.register(doc.context.obj({ Leftover: true }));
  return doc.save();
}

const firstImage = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  const found = doc.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFRawStream && o.dict.lookup(PDFName.of("Subtype")) === PDFName.of("Image"));
  const d = (found![1] as PDFRawStream).dict;
  const n = (k: string) => (d.lookup(PDFName.of(k)) as PDFNumber).asNumber();
  return { width: n("Width"), height: n("Height"), filter: d.lookup(PDFName.of("Filter"))?.toString(), colours: d.lookup(PDFName.of("ColorSpace"))?.toString() };
};

describe("making a PDF smaller", () => {
  it("brings a too-big picture down to what the page needs, and drops leftovers", async () => {
    const before = await bigPicture();
    const out = await squeeze(before, "medium", painter);
    expect(out.pictures).toBe(1);
    expect(out.dropped).toBeGreaterThanOrEqual(1);
    expect(out.bytes.length).toBeLessThan(before.length * 0.6);
    // 600 points tall page at 150 dots to the inch: 1250 pixels on its longest side.
    expect(await firstImage(out.bytes)).toEqual({ width: 1250, height: 938, filter: "/FlateDecode", colours: "/DeviceRGB" });
    // pdf.js still reads it and draws the page.
    const pdf = await getDocument({ data: out.bytes.slice(), verbosity: 0 }).promise;
    const ops = await (await pdf.getPage(1)).getOperatorList();
    expect(ops.fnArray.length).toBeGreaterThan(0);
  });

  it("keeps grey pictures grey", async () => {
    const out = await squeeze(await bigPicture(true), "medium", painter);
    expect(await firstImage(out.bytes)).toMatchObject({ width: 1250, height: 938, colours: "/DeviceGray" });
  });

  it("turns pictures into JPGs when asked for as small as possible", async () => {
    const out = await squeeze(await bigPicture(), "strong", painter);
    expect(await firstImage(out.bytes)).toEqual({ width: 800, height: 600, filter: "/DCTDecode", colours: "/DeviceRGB" });
  });

  it("only tidies without a painter, and leaves what it can't read alone", async () => {
    const before = await bigPicture();
    const out = await squeeze(before, "strong");
    expect(out.pictures).toBe(0);
    expect(await firstImage(out.bytes)).toMatchObject({ width: 2000, height: 1500 });
    const failing: Painter = { pixels: () => Promise.reject(new Error("no")), jpg: () => Promise.reject(new Error("no")) };
    expect((await squeeze(before, "medium", failing)).pictures).toBe(0);
  });

  it("drops only what nothing points to", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const kept = doc.context.register(doc.context.obj({ Kept: true }));
    doc.catalog.set(PDFName.of("Mine"), kept);
    const gone = doc.context.register(doc.context.obj({ Gone: true }));
    expect(dropUnused(doc)).toBe(1);
    expect(doc.context.lookup(kept)).toBeTruthy();
    expect(doc.context.lookup(gone as PDFRef)).toBeUndefined();
  });
});
