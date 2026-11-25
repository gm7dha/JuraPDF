import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { moveBy, moveTo, pagesLabel, pickPages, sameOrder, targetPages } from "../src/model/pages";
import { PageProblem, addBlankPage, deletePages, extractPages, insertPdf, reorderPages, turnPages } from "../src/pdf/pages";
import { keptSizes } from "../src/pdf/watermark";

const STANDARD_FONTS = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;

/** A PDF whose pages say their names, each a different width so they can be told apart. */
async function pdfOf(names: string[], turn = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  names.forEach((name, i) => {
    const page = doc.addPage([400 + i * 10, 600]);
    page.setRotation(degrees(turn));
    page.drawText(name, { x: 40, y: 500, size: 24, font });
  });
  return doc.save();
}

/** Each page's words and how it shows: [words, shown width, shown height]. */
async function readPages(bytes: Uint8Array): Promise<[string, number, number][]> {
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const out: [string, number, number][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const text = (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join("").trim();
    out.push([text, Math.round(vp.width), Math.round(vp.height)]);
  }
  await doc.destroy();
  return out;
}
const words = async (bytes: Uint8Array) => (await readPages(bytes)).map(([w]) => w);

describe("picking pages", () => {
  it("picks one, adds or takes away with Ctrl, and runs with Shift", () => {
    expect(pickPages([1, 2], 4, "only", 1)).toEqual([4]);
    expect(pickPages([1, 2], 4, "toggle", 1)).toEqual([1, 2, 4]);
    expect(pickPages([1, 2, 4], 2, "toggle", 1)).toEqual([1, 4]);
    expect(pickPages([5], 2, "run", 5)).toEqual([2, 3, 4, 5]);
    expect(pickPages([], 2, "run", null)).toEqual([2]);
  });

  it("works on the picked pages, or else the page being read", () => {
    expect(targetPages([3, 1, 3], 0, 5)).toEqual([1, 3]);
    expect(targetPages([], 2, 5)).toEqual([2]);
    expect(targetPages([9], 2, 5)).toEqual([2]);
    expect(pagesLabel([0])).toBe("page 1");
    expect(pagesLabel([1, 4])).toBe("pages 2 and 5");
    expect(pagesLabel([1, 2, 3])).toBe("3 pages");
  });

  it("works out new orders", () => {
    expect(moveTo(5, [3], 0)).toEqual([3, 0, 1, 2, 4]);
    expect(moveTo(5, [0, 1], 5)).toEqual([2, 3, 4, 0, 1]);
    expect(moveTo(5, [1, 3], 3)).toEqual([0, 2, 1, 3, 4]);
    expect(moveBy(5, [2], -1)).toEqual([0, 2, 1, 3, 4]);
    expect(moveBy(5, [2], 1)).toEqual([0, 1, 3, 2, 4]);
    expect(moveBy(5, [3, 4], 1)).toBeNull();
    expect(moveBy(5, [0], -1)).toBeNull();
    expect(moveBy(5, [1, 2], 1)).toEqual([0, 3, 1, 2, 4]);
    expect(sameOrder([0, 1, 2])).toBe(true);
    expect(sameOrder(moveTo(3, [1], 1))).toBe(true);
  });
});

describe("changing pages", () => {
  it("turns pages, and turned pages show the other way round", async () => {
    const out = await turnPages(await pdfOf(["A", "B"]), [1], 90);
    const pages = await readPages(out);
    expect(pages[0]).toEqual(["A", 400, 600]);
    expect(pages[1]).toEqual(["B", 600, 410]);
    const back = await readPages(await turnPages(out, [1], -90));
    expect(back[1]).toEqual(["B", 410, 600]);
  });

  it("deletes pages, but never the last one", async () => {
    const input = await pdfOf(["A", "B", "C", "D"]);
    expect(await words(await deletePages(input, [1, 3]))).toEqual(["A", "C"]);
    await expect(deletePages(input, [0, 1, 2, 3])).rejects.toBeInstanceOf(PageProblem);
  });

  it("reorders pages", async () => {
    const input = await pdfOf(["A", "B", "C", "D"]);
    expect(await words(await reorderPages(input, [3, 0, 1, 2]))).toEqual(["D", "A", "B", "C"]);
    await expect(reorderPages(input, [0, 0, 1, 2])).rejects.toBeInstanceOf(PageProblem);
  });

  it("adds a blank page the size of its neighbour", async () => {
    const out = await readPages(await addBlankPage(await pdfOf(["A", "B"]), 1));
    expect(out.map(([w]) => w)).toEqual(["A", "", "B"]);
    expect(out[1].slice(1)).toEqual([400, 600]);
    // Beside a turned page, the blank page shows the same way round.
    const turned = await readPages(await addBlankPage(await pdfOf(["A"], 90), 1));
    expect(turned[1].slice(1)).toEqual([600, 400]);
  });

  it("brings pages in from another PDF", async () => {
    const { bytes, added } = await insertPdf(await pdfOf(["A", "B"]), await pdfOf(["X", "Y", "Z"]), "other.pdf", 1);
    expect(added).toBe(3);
    expect(await words(bytes)).toEqual(["A", "X", "Y", "Z", "B"]);
    await expect(insertPdf(await pdfOf(["A"]), new TextEncoder().encode("not a pdf"), "junk.pdf", 0)).rejects.toThrow(/junk.pdf couldn't be read/);
  });

  it("saves chosen pages as a new PDF", async () => {
    expect(await words(await extractPages(await pdfOf(["A", "B", "C"]), [2, 0]))).toEqual(["C", "A"]);
  });
});

describe("changes one after another", () => {
  it("give the same pages as reading each version afresh", async () => {
    const start = await pdfOf(["A", "B", "C", "D", "E"]);
    // Each change works on the version the last one saved (kept ready, not read again).
    let kept: Uint8Array = await deletePages(start, [1]);
    kept = await reorderPages(kept, [3, 0, 1, 2]);
    kept = await turnPages(kept, [0], 90);
    kept = await addBlankPage(kept, 2);
    kept = await deletePages(kept, [4]);
    const part = await extractPages(kept, [1, 3]);
    // The same, from copies of the bytes (so nothing kept can be used).
    let fresh: Uint8Array = await deletePages(start.slice(), [1]);
    for (const step of [(b: Uint8Array) => reorderPages(b, [3, 0, 1, 2]), (b: Uint8Array) => turnPages(b, [0], 90), (b: Uint8Array) => addBlankPage(b, 2), (b: Uint8Array) => deletePages(b, [4])]) fresh = await step(fresh.slice());
    expect(await readPages(kept)).toEqual(await readPages(fresh));
    expect((await readPages(kept)).map((p) => p[0])).toEqual(["E", "A", "", "C"]);
    expect((await readPages(part)).map((p) => p[0])).toEqual(["A", "C"]);
  });
});

describe("page sizes from the kept PDF", () => {
  it("match what pdf.js shows, turned and cropped pages too", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]).setRotation(degrees(90));
    const cropped = doc.addPage([600, 800]);
    cropped.setCropBox(50, 100, 400, 500);
    const outside = doc.addPage([300, 300]);
    outside.setCropBox(200, 200, 500, 500);
    doc.addPage([842, 595]).setRotation(degrees(270));
    const bytes = await turnPages(await doc.save(), [4], 180);
    const kept = keptSizes(bytes)!;
    const shown = await readPages(bytes);
    expect(kept).toEqual(shown.map(([, w, h]) => [w, h]));
    expect(keptSizes(new Uint8Array(bytes))).toBeNull();
    // Straight after a delete, too.
    const fewer = await deletePages(bytes, [0, 1]);
    expect(keptSizes(fewer)).toHaveLength(3);
  });
});
