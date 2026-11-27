import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { changeLabel, hits, keptAt, moveItem, opacityOf, readKept, keptText, thinStroke, fitInk, type InkItem, type Kept, type ShapeItem, type WordsItem } from "../src/model/additions";
import { encodeWith, fontLabel, missingLetters, readCidWidths, readToUnicode, winAnsiCodes } from "../src/model/fontCodes";
import { nearestFont } from "../src/model/watermark";
import { addItems, changeItem } from "../src/pdf/additions";
import { keptIn } from "../src/pdf/items";
import { contentOf } from "../src/pdf/pictures";

const STANDARD_FONTS = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;

const box = (over: Partial<ShapeItem> = {}): ShapeItem => ({ kind: "shape", shape: "box", page: 0, x1: 100, y1: 100, x2: 200, y2: 160, colour: "#d1373a", thickness: 2, ...over });

describe("letters a font in the PDF can write", () => {
  it("reads a ToUnicode list's single codes and ranges, both ways round", () => {
    const cmap = `begincmap
2 beginbfchar
<0003> <0020>
<0011> <004B>
endbfchar
2 beginbfrange
<0020> <0022> <0061>
<0030> <0031> [<00E9> <20AC>]
endbfrange
endcmap`;
    const codes = readToUnicode(cmap, 2);
    expect(codes.get(" ")).toBe("0003");
    expect(codes.get("K")).toBe("0011");
    expect(codes.get("c")).toBe("0022");
    expect(codes.get("é")).toBe("0030");
    expect(codes.get("€")).toBe("0031");
    expect(encodeWith(codes, "Kab")).toBe("001100200021");
    expect(encodeWith(codes, "Kz")).toBeNull();
    expect(missingLetters(codes, "K z q")).toBe("z q");
  });

  it("knows WinAnsi's letters, curly quotes and euro included", () => {
    const codes = winAnsiCodes();
    expect(encodeWith(codes, "A é")).toBe("4120E9");
    expect(encodeWith(codes, "€“")).toBe("8093");
    expect(encodeWith(codes, "Ж")).toBeNull();
  });

  it("reads a two-byte font's widths in both forms", () => {
    const w = readCidWidths([1, [500, 600], 10, 12, 250]);
    expect([w.get(1), w.get(2), w.get(10), w.get(12), w.get(13)]).toEqual([500, 600, 250, 250, undefined]);
  });

  it("names fonts as people know them, and finds the nearest built-in one", () => {
    expect(fontLabel("ABCDEF+Calibri-BoldItalic")).toBe("Calibri bold slanted");
    expect(fontLabel("TimesNewRomanPSMT")).toBe("Times New Roman");
    expect(nearestFont("serif", true, true)).toBe("TimesRomanBoldItalic");
    expect(nearestFont("sans", false, true)).toBe("HelveticaOblique");
    expect(nearestFont("mono", true, false)).toBe("CourierBold");
  });
});

describe("picking and changing what was added", () => {
  const kept = (item: Kept["item"], b = { x: 100, y: 100, width: 100, height: 60 }): Kept => ({ id: 1, item, box: b });

  it("an empty box is picked by its edge (or anywhere when picking to change); a filled one anywhere", () => {
    expect(hits(kept(box()), 150, 130, false)).toBe(false);
    expect(hits(kept(box()), 101, 130, false)).toBe(true);
    expect(hits(kept(box()), 150, 130, true)).toBe(true);
    expect(hits(kept(box({ fill: "#ffff00" })), 150, 130, false)).toBe(true);
    expect(hits(kept(box()), 260, 130, true)).toBe(false);
  });

  it("a line is picked near it, not anywhere in its box; the topmost addition wins", () => {
    const line = box({ shape: "line", x1: 0, y1: 0, x2: 100, y2: 100 });
    expect(hits(kept(line, { x: 0, y: 0, width: 100, height: 100 }), 50, 52, false)).toBe(true);
    expect(hits(kept(line, { x: 0, y: 0, width: 100, height: 100 }), 80, 20, false)).toBe(false);
    const a = { id: 1, item: box({ fill: "#000000" }), box: { x: 100, y: 100, width: 100, height: 60 } };
    const b = { id: 2, item: box({ fill: "#ffffff" }), box: { x: 100, y: 100, width: 100, height: 60 } };
    expect(keptAt([a, b], 150, 130, false)?.id).toBe(2);
  });

  it("moves, labels, see-through and pen strokes", () => {
    expect(moveItem(box(), 10, -5)).toMatchObject({ x1: 110, y1: 95, x2: 210, y2: 155 });
    expect(changeLabel(box(), moveItem(box(), 5, 5))).toBe("move a box on page 1");
    expect(changeLabel(box(), box({ fill: "#ffff00" }))).toBe("change a box on page 1");
    expect(changeLabel(box(), null)).toBe("delete a box on page 1");
    expect(opacityOf({ seeThrough: 50 })).toBe(0.5);
    expect(opacityOf({ shape: "highlight", seeThrough: 0 })).toBeLessThan(1);
    const stroke = thinStroke([[0, 0], [0.1, 0], [0.2, 0], [5, 5], [5.1, 5.1]]);
    expect(stroke).toEqual([[0, 0], [5, 5], [5.1, 5.1]]);
    const ink: InkItem = { kind: "ink", page: 0, strokes: [[[10, 10], [20, 30]]], colour: "#000000", thickness: 2 };
    expect(fitInk(ink, { x: 10, y: 10, width: 10, height: 20 }, { x: 0, y: 0, width: 20, height: 40 }).strokes).toEqual([[[0, 0], [20, 40]]]);
    expect(readKept(keptText([{ id: 3, item: ink, box: { x: 0, y: 0, width: 1, height: 1 } }]))[0].id).toBe(3);
    expect(readKept("not json")).toEqual([]);
  });
});

/** A one-page A4 PDF with Helvetica (not carried in it) as /F1, saying "Hello". */
async function helloPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello", { x: 72, y: 700, size: 20, font });
  return doc.save();
}

const marks = (bytes: Uint8Array) =>
  PDFDocument.load(bytes).then((d) => {
    const text = new TextDecoder("latin1").decode(contentOf(d.getPage(0)));
    return { marks: (text.match(/\/JuraPDF\d+ BMC/g) ?? []).length, depth: Math.max(0, ...text.split("\n").map((_, i, all) => all.slice(0, i + 1).join("\n").split(/\bq\b/).length - all.slice(0, i + 1).join("\n").split(/\bQ\b/).length)) };
  });

async function wordsOn(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: STANDARD_FONTS, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const text = (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
  await doc.destroy();
  return text;
}

describe("additions stay changeable in the PDF", () => {
  it("each addition is marked and remembered; changing one redraws just it, deleting takes it away", async () => {
    let bytes: Uint8Array = await helloPdf();
    bytes = await addItems(bytes, [box({ fill: "#ffff00", seeThrough: 25 })]);
    bytes = await addItems(bytes, [{ kind: "ink", page: 0, strokes: [[[300, 300], [320, 340], [350, 310]]], colour: "#1f5fbf", thickness: 2 }]);
    let kept = (await keptIn(bytes))[0];
    expect(kept.map((k) => k.item.kind)).toEqual(["shape", "ink"]);
    expect(kept[0].item).toMatchObject({ fill: "#ffff00", seeThrough: 25 });
    expect((await marks(bytes)).marks).toBe(2);

    bytes = await changeItem(bytes, 0, kept[0].id, moveItem(kept[0].item, 50, 50));
    kept = (await keptIn(bytes))[0];
    expect(kept.length).toBe(2);
    expect(kept.find((k) => k.item.kind === "shape")?.item).toMatchObject({ x1: 150, y1: 150 });
    expect((await marks(bytes)).marks).toBe(2);

    bytes = await changeItem(bytes, 0, kept.find((k) => k.item.kind === "ink")!.id, null);
    expect((await keptIn(bytes))[0].map((k) => k.item.kind)).toEqual(["shape"]);
    expect((await marks(bytes)).marks).toBe(1);
    expect(await wordsOn(bytes)).toContain("Hello");
  });

  it("many additions don't keep wrapping the page's drawing deeper and deeper", async () => {
    let bytes: Uint8Array = await helloPdf();
    for (let i = 0; i < 8; i++) bytes = await addItems(bytes, [box({ x1: 10 * i, x2: 10 * i + 20 })]);
    const m = await marks(bytes);
    expect(m.marks).toBe(8);
    expect(m.depth).toBeLessThan(4);
  });

  it("changed words are written in the PDF's own font when it has their letters", async () => {
    const before = await helloPdf();
    const font = (await PDFDocument.load(before)).getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    const words: WordsItem = { kind: "words", page: 0, x: 72, y: 120, text: "Help", font: "TimesRoman", size: 20, colour: "#000000", cover: { x: 70, y: 120, width: 60, height: 24 }, own: { base: "Helvetica", label: "Helvetica" } };
    const after = await addItems(before, [words]);
    const fonts = (await PDFDocument.load(after)).getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    expect(fonts.keys().length).toBe(font.keys().length);
    expect(await wordsOn(after)).toContain("Help");
    // A font that isn't there: the nearest built-in one is used instead.
    const other = await addItems(before, [{ ...words, own: { base: "NoSuchFont", label: "No such font" } }]);
    const more = (await PDFDocument.load(other)).getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    expect(more.keys().length).toBe(font.keys().length + 1);
  });
});

describe("form boxes", () => {
  it("text boxes, tick boxes and choice lists become real form boxes that can be moved, renamed and deleted", async () => {
    const { fieldBox, freshFieldName, choicesOf } = await import("../src/model/additions");
    expect(fieldBox("text", 100, 100, 101, 101)).toEqual({ x: 100, y: 100, width: 180, height: 22 });
    expect(fieldBox("tick", 100, 100, 130, 110)).toEqual({ x: 100, y: 100, width: 30, height: 30 });
    expect(freshFieldName("text", ["Text 1", "Text 2"])).toBe("Text 3");
    expect(choicesOf("Red\nGreen, Blue\n\nRed")).toEqual(["Red", "Green", "Blue"]);

    let bytes: Uint8Array = await helloPdf();
    bytes = await addItems(bytes, [
      { kind: "field", field: "text", page: 0, x: 72, y: 200, width: 200, height: 22, name: "Work order", multiline: false },
      { kind: "field", field: "tick", page: 0, x: 72, y: 240, width: 14, height: 14, name: "Work order" },
      { kind: "field", field: "choice", page: 0, x: 72, y: 270, width: 150, height: 22, name: "Shift", choices: ["Day", "Night"] },
    ]);
    const names = async (b: Uint8Array) => (await PDFDocument.load(b)).getForm().getFields().map((f) => f.getName()).sort();
    expect(await names(bytes)).toEqual(["Shift", "Tick 1", "Work order"]);
    const kept = (await keptIn(bytes))[0];
    expect(kept.map((k) => (k.item.kind === "field" ? k.item.name : ""))).toEqual(["Work order", "Tick 1", "Shift"]);

    const text = kept[0];
    bytes = await changeItem(bytes, 0, text.id, { ...moveItem(text.item, 10, 30), name: "Order number" } as typeof text.item);
    expect(await names(bytes)).toEqual(["Order number", "Shift", "Tick 1"]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).node.Annots()?.size()).toBe(3);

    bytes = await changeItem(bytes, 0, kept[1].id, null);
    expect(await names(bytes)).toEqual(["Order number", "Shift"]);
    // pdf.js sees them as form boxes to fill in.
    const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: STANDARD_FONTS, verbosity: 0 }).promise;
    const annots = await (await pdf.getPage(1)).getAnnotations();
    expect(annots.map((a) => a.fieldName).sort()).toEqual(["Order number", "Shift"]);
    await pdf.destroy();
  });
});
