import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { lettersBox, markFrom, marksByPage, marksLabel, onRun, overlaps, quarterTurned, runBox, textBoxFrom, wordsOutside } from "../src/model/redact";
import { Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { blackOut, RedactProblem } from "../src/pdf/redact";

const STANDARD_FONTS = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;
/** A tiny white JPG (the browser makes the real picture of the page). */
const JPG = new Uint8Array(Buffer.from("ffd8ffe000104a46494600010100000100010000ffdb004300100b0c0e0c0a100e0d0e1211101318281a181616183123251d283a333d3c3933383740485c4e404457453738506d51575f626768673e4d71797064785c656763ffdb0043011112121815182f1a1a2f634238426363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363636363ffc00011080008000803012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00f40a28a2803fffd9", "hex"));

async function testPdf(turn = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([400, 500]);
    if (turn) page.setRotation(degrees(turn));
    page.drawText(`Secret ${i + 1}`, { x: 50, y: 400, size: 20, font });
  }
  const form = doc.getForm();
  form.createTextField("pin").addToPage(doc.getPage(0), { x: 50, y: 300, width: 100, height: 20 });
  form.createTextField("other").addToPage(doc.getPage(0), { x: 250, y: 100, width: 100, height: 20 });
  return doc.save();
}

async function wordsOn(bytes: Uint8Array, n: number) {
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  const annots = await page.getAnnotations();
  await doc.destroy();
  return { words: content.items.map((i) => ("str" in i ? i.str : "")).join(" ").trim(), annots: annots.map((a) => a.fieldName as string) };
}

describe("marking places to black out", () => {
  it("makes boxes from two corners, kept on the page", () => {
    expect(markFrom(0, 50, 60, 10, 20, 100, 100)).toEqual({ page: 0, x: 10, y: 20, width: 40, height: 40 });
    expect(markFrom(0, -10, -10, 300, 5, 100, 100)).toEqual({ page: 0, x: 0, y: 0, width: 100, height: 5 });
    expect(markFrom(0, 1, 1, 2, 2, 100, 100)).toBeNull();
  });

  it("boxes letters of a bit of words", () => {
    expect(lettersBox({ str: "abcd", x: 0, y: 10, width: 40, height: 10 }, 1, 3, 2, 0)).toEqual({ page: 2, x: 10, y: 10, width: 20, height: 10 });
  });

  it("keeps only the letters no mark touches", () => {
    const bits = [
      { str: "Name: Kevin Pugh", x: 0, y: 0, width: 160, height: 10 },
      { str: "Untouched", x: 0, y: 50, width: 90, height: 10 },
    ];
    // Covers "Kevin" (letters 6 to 10, 10 points each).
    const kept = wordsOutside(bits, [{ x: 60, y: 0, width: 50, height: 10 }]);
    expect(kept.map((k) => k.text)).toEqual(["Name: ", " Pugh", "Untouched"]);
    expect(kept[1]).toMatchObject({ x: 110, width: 50 });
    expect(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
  });

  it("groups and counts marks", () => {
    const marks = [
      { page: 2, x: 0, y: 0, width: 5, height: 5 },
      { page: 0, x: 0, y: 0, width: 5, height: 5 },
      { page: 2, x: 9, y: 9, width: 5, height: 5 },
    ];
    expect([...marksByPage(marks).keys()]).toEqual([0, 2]);
    expect(marksLabel(marks)).toBe("3 places on 2 pages");
    expect(marksLabel(marks.slice(0, 1))).toBe("1 place on page 3");
  });
});

/** Each bit of words on a page as the app sees it (as shown, points from the top-left). */
async function boxesOn(bytes: Uint8Array, n: number) {
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const page = await doc.getPage(n);
  const unit = page.getViewport({ scale: 1 });
  const items = (await page.getTextContent()).items.flatMap((i) => ("str" in i && i.str.trim() ? [i] : []));
  await doc.destroy();
  return items.map((i) => textBoxFrom(i.str, Util.transform(unit.transform, i.transform), i.width, i.height)!);
}

describe("words that aren't level (turned pages)", () => {
  it("boxes sideways and upside-down runs", () => {
    // Reading down the page (turned 90° clockwise as shown, tops of the letters to the right), from (100, 50), 60 long, letters 10 tall.
    expect(runBox({ x: 100, y: 50, turn: 90, length: 60, size: 10 }, 0, 60)).toEqual({ x: 98, y: 50, width: 12, height: 60 });
    const upside = runBox({ x: 100, y: 50, turn: 180, length: 60, size: 10 }, 0, 30);
    expect(upside.x).toBeCloseTo(70);
    expect(upside.y).toBeCloseTo(48);
    expect(upside.width).toBeCloseTo(30);
    expect(upside.height).toBeCloseTo(12);
    // On the letters themselves, not just in the box round them.
    const slant = { x: 0, y: 100, turn: -45, length: 100, size: 10 };
    expect(onRun(slant, 35, 65)).toBe(true);
    expect(onRun(slant, 60, 90)).toBe(false);
    expect(quarterTurned(slant)).toBe(false);
    expect([90, 180, -90, 270, 88].map((turn) => quarterTurned({ ...slant, turn }))).toEqual([true, true, true, true, true]);
    // Mirrored words are marked as not usable.
    expect(textBoxFrom("x", [10, 0, 0, 10, 0, 0], 5, 10)?.usable).toBe(false);
    expect(textBoxFrom("x", [10, 0, 0, -10, 0, 0], 5, 10)?.usable).toBe(true);
  });

  for (const turn of [90, 180, 270]) {
    it(`finds and blacks out the right letters on a page turned ${turn}°, keeping the rest`, async () => {
      const before = await testPdf(turn);
      const [bit] = await boxesOn(before, 2);
      expect(bit.str).toBe("Secret 2");
      expect(bit.along).toBeTruthy();
      // "Secret" (letters 0–6): its box is where pdf.js shows those letters.
      const mark = lettersBox(bit, 0, 6, 1);
      const kept = wordsOutside([bit], [mark]);
      expect(kept.map((k) => k.text.trim())).toEqual(["2"]);
      const out = await blackOut(before, [{ page: 1, picture: JPG, marks: [mark], words: kept }]);
      const [after] = await boxesOn(out, 2);
      expect(after.str.trim()).toBe("2");
      // Written back where it was, turned the same way.
      expect(after.along!.turn).toBeCloseTo(bit.along!.turn, 0);
      const was = kept[0].along!;
      expect(Math.hypot(after.along!.x - was.x, after.along!.y - was.y)).toBeLessThan(1.5);
    });
  }
});

describe("blacking out for good", () => {
  it("takes away everything the page drew, keeps the words outside, and drops form boxes under a mark", async () => {
    const out = await blackOut(await testPdf(), [
      {
        page: 0,
        picture: JPG,
        // Over the "pin" box (shown 50..150 across, 180..200 down).
        marks: [{ page: 0, x: 40, y: 175, width: 120, height: 30 }],
        words: [{ text: "Secret", x: 50, y: 80, width: 60, height: 22 }],
      },
    ]);
    const one = await wordsOn(out, 1);
    expect(one.words).toBe("Secret");
    expect(one.annots).toEqual(["other"]);
    expect((await PDFDocument.load(out)).getForm().getFields().map((f) => f.getName())).toEqual(["other"]);
    // Pages not blacked out are as they were.
    expect((await wordsOn(out, 2)).words).toBe("Secret 2");
  });

  it("works on turned pages, which keep their turn", async () => {
    const out = await blackOut(await testPdf(90), [{ page: 1, picture: JPG, marks: [{ page: 1, x: 0, y: 0, width: 50, height: 50 }], words: [] }]);
    expect((await wordsOn(out, 2)).words).toBe("");
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });

  it("needs something marked", async () => {
    await expect(blackOut(await testPdf(), [])).rejects.toThrow(RedactProblem);
  });
});
