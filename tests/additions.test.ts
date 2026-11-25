import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, degrees } from "pdf-lib";
import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { additionLabel, arrowHead, cleanSize, shapeBox, shapeInPage, sizedShape, type ShapeItem, keepOnPage, lineStarts, linesOf, startingPictureSize, wordsHeight, type WordsItem } from "../src/model/additions";
import { AddProblem, addPicture, addShape, addWords, pictureType, textWidth, unwritable } from "../src/pdf/additions";

const STANDARD_FONTS = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;

/** A4 upright, then A4 turned a quarter (shows landscape), then landscape turned half. */
async function testPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h, turn] of [
    [595, 842, 0],
    [595, 842, 90],
    [842, 595, 180],
  ]) doc.addPage([w, h]).setRotation(degrees(turn));
  return doc.save();
}

/** A 2×1 pixel red PNG. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAN/gH/w+1JvwAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const words = (over: Partial<WordsItem> = {}): WordsItem => ({ kind: "words", page: 0, x: 100, y: 200, text: "Hello", font: "Helvetica", size: 20, colour: "#ff0000", ...over });

async function open(bytes: Uint8Array, n: number) {
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: STANDARD_FONTS, verbosity: 0 }).promise;
  const page = await doc.getPage(n + 1);
  return { doc, page, vp: page.getViewport({ scale: 1 }) };
}

/** Each bit of text on a page: where its line starts as shown (from the top-left), and which way it runs. */
async function textOn(bytes: Uint8Array, n: number) {
  const { doc, page, vp } = await open(bytes, n);
  const items = (await page.getTextContent()).items
    .filter((it): it is typeof it & { str: string; transform: number[] } => "str" in it && it.str.trim() !== "")
    .map((it) => {
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const [ax, ay] = vp.convertToViewportPoint(it.transform[4] + it.transform[0], it.transform[5] + it.transform[1]);
      return { str: it.str, x, y, angle: Math.round((Math.atan2(-(ay - y), ax - x) * 180) / Math.PI) };
    });
  await doc.destroy();
  return items;
}

/** Where pictures land as shown: the box their corners make. */
async function picturesOn(bytes: Uint8Array, n: number) {
  const { doc, page, vp } = await open(bytes, n);
  const ops = await page.getOperatorList();
  const boxes: { left: number; top: number; right: number; bottom: number }[] = [];
  let m = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const times = (a: number[], b: number[]) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  ops.fnArray.forEach((fn, i) => {
    if (fn === OPS.save) stack.push(m);
    else if (fn === OPS.restore) m = stack.pop() ?? m;
    else if (fn === OPS.transform) m = times(m, ops.argsArray[i] as number[]);
    else if (fn === OPS.paintImageXObject) {
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([u, v]) => vp.convertToViewportPoint(m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]));
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      boxes.push({ left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) });
    }
  });
  await doc.destroy();
  return boxes;
}

describe("placing words", () => {
  it("splits typed words into lines", () => {
    expect(linesOf("\n one\r\ntwo  \n\nthree\n\n")).toEqual([" one", "two", "", "three"]);
    expect(linesOf("   ")).toEqual([]);
  });

  it("puts each line one line-height below the last", () => {
    const starts = lineStarts(words({ text: "a\n\nb", y: 10, size: 10 }));
    expect(starts.map((s) => s.text)).toEqual(["a", "b"]);
    expect(starts[0].y).toBeCloseTo(10 + 9.47, 2);
    expect(starts[1].y - starts[0].y).toBeCloseTo(24, 5);
    expect(wordsHeight({ text: "a\nb", size: 10 })).toBe(24);
  });

  it("keeps sizes and boxes sensible", () => {
    expect(cleanSize(1)).toBe(4);
    expect(cleanSize(1000)).toBe(300);
    expect(cleanSize(NaN)).toBe(14);
    expect(keepOnPage(-500, 900, 100, 50, 595, 842)).toEqual({ x: -88, y: 830 });
    expect(keepOnPage(10, 10, 100, 50, 595, 842)).toEqual({ x: 10, y: 10 });
  });

  it("starts a picture at its own size, at least an inch and no more than half the page", () => {
    expect(startingPictureSize(200, 100, 595, 842)).toEqual({ width: 150, height: 75 });
    expect(startingPictureSize(2, 1, 595, 842)).toEqual({ width: 72, height: 36 });
    const big = startingPictureSize(4000, 2000, 595, 842);
    expect(big.width).toBeCloseTo(297.5, 5);
    expect(big.height).toBeCloseTo(148.75, 5);
  });

  it("names the change for Undo", () => {
    expect(additionLabel(words({ text: "Approved\nby me" }))).toBe("add “Approved” to page 1");
    expect(additionLabel({ kind: "picture", page: 2, x: 0, y: 0, width: 1, height: 1 })).toBe("add a picture to page 3");
  });

  it("measures words and finds letters the fonts can't write", () => {
    expect(textWidth("Courier", "abcd", 10)).toBeCloseTo(24, 5);
    expect(unwritable("Helvetica", "Café ✓ 日")).toBe("✓ 日");
    expect(unwritable("Helvetica", "Café €")).toBe("");
  });
});

describe("writing words and pictures", () => {
  it("writes words where they were typed, level, on upright and turned pages", async () => {
    let bytes: Uint8Array = await testPdf();
    for (const page of [0, 1, 2]) bytes = await addWords(bytes, words({ page, text: `Hi ${page}\nSecond` }));
    for (const page of [0, 1, 2]) {
      const items = await textOn(bytes, page);
      const first = items.find((i) => i.str === `Hi ${page}`)!;
      const second = items.find((i) => i.str === "Second")!;
      expect(first.angle + 0).toBe(0);
      expect(first.x).toBeCloseTo(100, 1);
      expect(first.y).toBeCloseTo(200 + 0.947 * 20, 1);
      expect(second.y - first.y).toBeCloseTo(24, 1);
    }
  });

  it("turns away words with nothing in them, unwritable letters, and missing pages", async () => {
    const bytes = await testPdf();
    await expect(addWords(bytes, words({ text: "  \n " }))).rejects.toBeInstanceOf(AddProblem);
    await expect(addWords(bytes, words({ text: "Tick ✓" }))).rejects.toThrow(/✓/);
    await expect(addWords(bytes, words({ page: 7 }))).rejects.toThrow(/no page 8/);
  });

  it("puts a picture where it was placed, the right way up, on upright and turned pages", async () => {
    expect(pictureType(PNG)).toBe("png");
    expect(pictureType(new Uint8Array([1, 2, 3]))).toBeNull();
    let bytes: Uint8Array = await testPdf();
    for (const page of [0, 1, 2]) bytes = await addPicture(bytes, { kind: "picture", page, x: 50, y: 60, width: 200, height: 100 }, { bytes: PNG, type: "png", name: "dot.png" });
    for (const page of [0, 1, 2]) {
      const [box] = await picturesOn(bytes, page);
      expect(box.left).toBeCloseTo(50, 1);
      expect(box.top).toBeCloseTo(60, 1);
      expect(box.right).toBeCloseTo(250, 1);
      expect(box.bottom).toBeCloseTo(160, 1);
    }
    await expect(addPicture(bytes, { kind: "picture", page: 0, x: 0, y: 0, width: 1, height: 1 }, { bytes: new Uint8Array([1, 2]), type: "png", name: "bad.png" })).rejects.toThrow(/bad.png/);
  });
});

const shape = (over: Partial<ShapeItem> = {}): ShapeItem => ({ kind: "shape", shape: "box", page: 0, x1: 100, y1: 200, x2: 300, y2: 260, colour: "#ff0000", thickness: 2, ...over });

describe("shapes", () => {
  it("fill the box between their two points, whichever way they were drawn", () => {
    expect(shapeBox(shape({ x1: 300, y1: 260, x2: 100, y2: 200 }))).toEqual({ x: 100, y: 200, width: 200, height: 60 });
  });

  it("get a sensible size from a click", () => {
    expect(shapeBox(sizedShape(shape({ x2: 101, y2: 201 })))).toEqual({ x: 100, y: 200, width: 100, height: 60 });
    expect(sizedShape(shape({ shape: "arrow", x2: 100, y2: 200 }))).toMatchObject({ x2: 200, y2: 200 });
    expect(sizedShape(shape())).toEqual(shape());
  });

  it("put an arrow's head at its end, pointing along it", () => {
    const [tip, left, right] = arrowHead({ x1: 0, y1: 0, x2: 100, y2: 0, thickness: 2 });
    expect(tip).toEqual([100, 0]);
    expect(left[0]).toBeCloseTo(88, 5);
    expect(right[0]).toBeCloseTo(88, 5);
    expect(left[1]).toBeCloseTo(-right[1], 5);
    expect(Math.abs(left[1])).toBeGreaterThan(4);
  });

  it("land where they were drawn on upright and turned pages", () => {
    const upright = { x: 0, y: 0, width: 595, height: 842, rotation: 0 };
    // As shown, y runs down from the top; the page's own space runs up from the bottom.
    expect(shapeInPage(upright, shape()).box).toEqual({ x: 100, y: 842 - 260, width: 200, height: 60 });
    // A page turned a quarter shows 842 wide and 595 tall; a shown box comes out on its side in the page's own space.
    const turned = { x: 0, y: 0, width: 595, height: 842, rotation: 90 };
    const box = shapeInPage(turned, shape()).box;
    expect(box).toEqual({ x: 200, y: 100, width: 60, height: 200 });
    const arrow = shapeInPage(upright, shape({ shape: "arrow", x1: 100, y1: 100, x2: 200, y2: 100 }));
    expect(arrow.head![0]).toEqual({ x: 200, y: 742 });
    expect(arrow.end.x).toBeLessThan(200);
  });

  it("are written into the page (a highlight see-through and multiplied in)", async () => {
    let bytes: Uint8Array = await testPdf();
    for (const s of ["highlight", "box", "oval", "line", "arrow"] as const) bytes = await addShape(bytes, shape({ shape: s, page: s === "arrow" ? 1 : 0 }));
    const doc = await PDFDocument.load(bytes);
    const states = doc.getPage(0).node.Resources()!.lookup(PDFName.of("ExtGState"), PDFDict);
    const modes = states.keys().map((k) => String(states.lookup(k, PDFDict).get(PDFName.of("BM")) ?? ""));
    expect(modes).toContain("/Multiply");
    const { doc: read, page } = await open(bytes, 0);
    const ops = await page.getOperatorList();
    // The box, the oval and the line are drawn as outlines; the highlight is filled.
    expect(ops.fnArray.filter((f) => f === OPS.stroke || f === OPS.closeStroke).length).toBeGreaterThanOrEqual(3);
    expect(ops.fnArray.filter((f) => f === OPS.fill || f === OPS.eoFill).length).toBeGreaterThanOrEqual(1);
    await read.destroy();
    await expect(addShape(bytes, shape({ page: 9 }))).rejects.toThrow(/no page 10/);
  });

  it("are named for Undo", () => {
    expect(additionLabel(shape({ shape: "highlight" }))).toBe("add a highlight to page 1");
    expect(additionLabel(shape({ shape: "arrow", page: 1 }))).toBe("add an arrow to page 2");
  });
});

describe("one change after another on the same page", () => {
  it("keeps everything drawn by each", async () => {
    let bytes: Uint8Array = await testPdf();
    bytes = await addWords(bytes, words({ text: "First" }));
    bytes = await addWords(bytes, words({ text: "Second", y: 300 }));
    bytes = await addWords(bytes, words({ text: "Third", y: 400 }));
    expect((await textOn(bytes, 0)).map((i) => i.str)).toEqual(["First", "Second", "Third"]);
  });
});
