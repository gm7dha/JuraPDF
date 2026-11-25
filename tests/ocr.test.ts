import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { readingSummary, wordsToAdd, type FoundWord } from "../src/model/ocr";
import { addHiddenWords } from "../src/pdf/additions";

const word = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90): FoundWord => ({ text, confidence, bbox: { x0, y0, x1, y1 } });

describe("which words read from pictures to add", () => {
  it("turns pixels into points and keeps the words it's sure of", () => {
    const out = wordsToAdd([word("Invoice", 300, 600, 700, 700), word("smudge", 0, 0, 50, 50, 20)], [], 4);
    expect(out).toEqual([{ text: "Invoice", x: 75, y: 150, width: 100, height: 25 }]);
  });

  it("leaves out words the page already has, and stray marks", () => {
    const existing = [{ x: 70, y: 148, width: 110, height: 30 }];
    expect(wordsToAdd([word("Invoice", 300, 600, 700, 700), word("|", 800, 600, 810, 700), word("Total", 800, 800, 1000, 880)], existing, 4).map((w) => w.text)).toEqual(["Total"]);
  });

  it("says what it found", () => {
    expect(readingSummary(new Map([[2, 52]]))).toMatch(/^Found 52 words in the pictures on page 3\./);
    expect(readingSummary(new Map([[0, 1], [1, 0]]))).toMatch(/^Found 1 word in the pictures on 2 pages\./);
    expect(readingSummary(new Map([[0, 0]]))).toBe("No words found in the pictures on page 1.");
  });
});

async function wordsOn(bytes: Uint8Array, page: number) {
  const pdf = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const p = await pdf.getPage(page + 1);
  const view = p.getViewport({ scale: 1 });
  const items = (await p.getTextContent()).items.filter((i) => "str" in i && i.str.trim()) as { str: string; transform: number[]; width: number }[];
  return items.map((i) => {
    const [x, y] = view.convertToViewportPoint(i.transform[4], i.transform[5]);
    return { str: i.str, x, y, width: i.width };
  });
}

describe("writing read words into the page", () => {
  it("puts each word where it showed, stretched over it, so it can be picked and found", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const bytes = await addHiddenWords(await doc.save(), 0, [{ text: "Invoice", x: 75, y: 150, width: 100, height: 20 }]);
    const [w] = await wordsOn(bytes, 0);
    expect(w.str).toBe("Invoice");
    expect(w.x).toBeCloseTo(75, 0);
    // The baseline a fifth of the way up from the box's bottom.
    expect(w.y).toBeCloseTo(166, 0);
    expect(Math.abs(w.width - 100)).toBeLessThan(3);
  });

  it("works on a turned page, and leaves out letters it can't write", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).setRotation(degrees(90));
    const bytes = await addHiddenWords(await doc.save(), 0, [{ text: "Total✓", x: 300, y: 100, width: 80, height: 20 }]);
    const [w] = await wordsOn(bytes, 0);
    expect(w.str).toBe("Total");
    expect(w.x).toBeCloseTo(300, 0);
    expect(w.y).toBeCloseTo(116, 0);
  });
});
