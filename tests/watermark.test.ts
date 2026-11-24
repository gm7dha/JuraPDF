import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  DEFAULT_WATERMARK,
  angleFor,
  choosePages,
  cleanSettings,
  fitScale,
  hexToRgb,
  shownSize,
  stampsFor,
  startCorner,
  toPageSpace,
  turnedBox,
  type WatermarkSettings,
} from "../src/model/watermark";
import { LockedPdf, WatermarkProblem, addWatermark, loadForEditing, previewPage } from "../src/pdf/watermark";

const STANDARD_FONTS = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;

const settings = (over: Partial<WatermarkSettings> = {}): WatermarkSettings => ({ ...DEFAULT_WATERMARK, ...over });

/** A test PDF: A4 portrait, A4 landscape, and an A4 page turned a quarter (shows landscape). Each says "Page N". */
async function testPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [i, [w, h, turn]] of [
    [595, 842, 0],
    [842, 595, 0],
    [595, 842, 90],
  ].entries()) {
    const page = doc.addPage([w, h]);
    page.setRotation(degrees(turn));
    page.drawText(`Page ${i + 1}`, { x: 50, y: 50, size: 20, font });
  }
  return doc.save();
}

/** Where pdf.js finds each bit of text on page `n`, as shown (x right, y up from the bottom-left), and the page's shown size. */
async function textOn(bytes: Uint8Array, n: number) {
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items
    .filter((it): it is typeof it & { str: string; transform: number[]; width: number } => "str" in it && it.str.trim() !== "")
    .map((it) => {
      // Text space → shown space (pdf.js's viewport flips y; turn it back so y is up).
      const [x, yDown] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const [ax, ayDown] = vp.convertToViewportPoint(it.transform[4] + it.transform[0], it.transform[5] + it.transform[1]);
      const angle = (Math.atan2(-(ayDown - yDown), ax - x) * 180) / Math.PI;
      return { str: it.str, x, y: vp.height - yDown, angle, width: it.width, size: Math.hypot(it.transform[0], it.transform[1]) };
    });
  await doc.destroy();
  return { items, width: vp.width, height: vp.height };
}

describe("watermark layout", () => {
  it("runs corner to corner by default", () => {
    expect(angleFor(settings(), 595, 842)).toBeCloseTo(54.75, 1);
    expect(angleFor(settings({ angle: "level" }), 595, 842)).toBe(0);
    expect(angleFor(settings({ angle: "custom", customAngle: -20 }), 595, 842)).toBe(-20);
  });

  it("fills the page as far as it fits once turned", () => {
    const deg = angleFor(settings(), 595, 842);
    const k = fitScale(10, 1, deg, 595, 842);
    const [bw, bh] = turnedBox(10 * k, k, deg);
    expect(bw).toBeLessThanOrEqual(595 * 0.861);
    expect(bh).toBeLessThanOrEqual(842 * 0.861);
    expect(Math.max(bw / 595, bh / 842)).toBeCloseTo(0.86, 2);
  });

  it("puts the corner placements inside the page", () => {
    for (const p of ["top-left", "top-right", "bottom-left", "bottom-right", "top", "bottom"] as const) {
      const [s] = stampsFor(p, 200, 40, 0, 595, 842);
      expect(s.x - 100).toBeGreaterThanOrEqual(0);
      expect(s.x + 100).toBeLessThanOrEqual(595);
      expect(s.y - 20).toBeGreaterThanOrEqual(0);
      expect(s.y + 20).toBeLessThanOrEqual(842);
    }
    const [tl] = stampsFor("top-left", 200, 40, 0, 595, 842);
    expect(tl.x).toBeLessThan(595 / 2);
    expect(tl.y).toBeGreaterThan(842 / 2);
  });

  it("repeats copies all over the page", () => {
    const stamps = stampsFor("repeat", 120, 20, 45, 595, 842);
    expect(stamps.length).toBeGreaterThan(10);
    // Some near each corner.
    for (const [cx, cy] of [
      [0, 0],
      [595, 0],
      [0, 842],
      [595, 842],
    ]) {
      expect(stamps.some((s) => Math.hypot(s.x - cx, s.y - cy) < 250)).toBe(true);
    }
  });

  it("turns shown positions into the page's own space for turned pages", () => {
    const frame = { x: 10, y: 20, width: 595, height: 842, rotation: 90 };
    expect(shownSize(frame)).toEqual([842, 595]);
    // The shown bottom-left corner of a page turned a quarter clockwise is its own top-left.
    expect(toPageSpace(frame, 0, 0, 0)).toEqual({ x: 10 + 595, y: 20, angle: 90 });
    expect(toPageSpace({ ...frame, rotation: 0 }, 5, 6, 30)).toEqual({ x: 15, y: 26, angle: 30 });
    expect(toPageSpace({ ...frame, rotation: 180 }, 0, 0, 0)).toEqual({ x: 605, y: 862, angle: 180 });
    expect(toPageSpace({ ...frame, rotation: 270 }, 0, 0, 0)).toEqual({ x: 10, y: 862, angle: 270 });
  });

  it("starts writing so the middle lands where asked", () => {
    const [x, y] = startCorner(100, 100, 40, 10, 90);
    // Turned a quarter, the item runs upwards from its start: the middle is 20 up and 5 to the left.
    expect(x).toBeCloseTo(105, 6);
    expect(y).toBeCloseTo(80, 6);
  });

  it("chooses pages and reads colours and saved settings safely", () => {
    expect(choosePages(settings({ pages: "odd" }), 5)).toEqual({ pages: [1, 3, 5] });
    expect(choosePages(settings({ pages: "even" }), 5)).toEqual({ pages: [2, 4] });
    expect(choosePages(settings({ pages: "range", range: "2-3" }), 5)).toEqual({ pages: [2, 3] });
    expect("error" in choosePages(settings({ pages: "range", range: "" }), 5)).toBe(true);
    expect(hexToRgb("#ff0080")).toEqual([1, 0, 128 / 255]);
    const cleaned = cleanSettings({ seeThrough: 400, font: "Comic", colour: "red", text: 5 });
    expect(cleaned.seeThrough).toBe(95);
    expect(cleaned.font).toBe(DEFAULT_WATERMARK.font);
    expect(cleaned.colour).toBe(DEFAULT_WATERMARK.colour);
    expect(cleaned.text).toBe(DEFAULT_WATERMARK.text);
  });
});

describe("writing a watermark into a PDF", () => {
  it("writes the words corner to corner in the middle of every page, turned pages included", async () => {
    const input = await testPdf();
    const { bytes, pages } = await addWatermark(input, settings({ text: "DRAFT" }));
    expect(pages).toEqual([1, 2, 3]);
    for (const n of [1, 2, 3]) {
      const { items, width, height } = await textOn(bytes, n);
      expect(items.some((i) => i.str === `Page ${n}`)).toBe(true);
      const mark = items.find((i) => i.str === "DRAFT");
      expect(mark, `page ${n}`).toBeTruthy();
      // Rising to the right, from corner to corner, as the page shows.
      expect(mark!.angle).toBeCloseTo((Math.atan2(height, width) * 180) / Math.PI, 0);
      // Its middle (half along, and half a capital letter up from the line it sits on) is at the page's middle.
      const a = (mark!.angle * Math.PI) / 180;
      const up = mark!.size * 0.36;
      const midX = mark!.x + (Math.cos(a) * mark!.width) / 2 - Math.sin(a) * up;
      const midY = mark!.y + (Math.sin(a) * mark!.width) / 2 + Math.cos(a) * up;
      expect(Math.hypot(midX - width / 2, midY - height / 2)).toBeLessThan(15);
      // Big: it spans most of the diagonal.
      expect(mark!.width).toBeGreaterThan(Math.hypot(width, height) * 0.5);
    }
  });

  it("only touches the chosen pages, keeps the page count, and can go behind", async () => {
    const input = await testPdf();
    const { bytes } = await addWatermark(input, settings({ text: "COPY", pages: "range", range: "2", behind: true, angle: "level" }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    expect((await textOn(bytes, 1)).items.some((i) => i.str === "COPY")).toBe(false);
    const p2 = await textOn(bytes, 2);
    const mark = p2.items.find((i) => i.str === "COPY")!;
    expect(mark.angle).toBeCloseTo(0, 3);
    // Behind: the watermark is drawn before the page's own words.
    expect(p2.items.findIndex((i) => i.str === "COPY")).toBeLessThan(p2.items.findIndex((i) => i.str === "Page 2"));
  });

  it("writes in front, after the page's own drawing, see-through", async () => {
    const { bytes } = await addWatermark(await testPdf(), settings({ text: "COPY", seeThrough: 75 }));
    const p1 = await textOn(bytes, 1);
    expect(p1.items.findIndex((i) => i.str === "COPY")).toBeGreaterThan(p1.items.findIndex((i) => i.str === "Page 1"));
    // The see-through setting is saved with the page: a graphics state with 25% ink.
    const doc = await PDFDocument.load(bytes);
    const states = doc.getPage(0).node.Resources()?.lookup(PDFName.of("ExtGState"), PDFDict);
    const inks = (states?.values() ?? [])
      .map((v) => doc.context.lookup(v))
      .filter((o): o is PDFDict => o instanceof PDFDict && o.has(PDFName.of("ca")))
      .map((o) => (o.get(PDFName.of("ca")) as PDFNumber).asNumber());
    expect(inks).toContain(0.25);
  });

  it("repeats words across the page", async () => {
    const { bytes } = await addWatermark(await testPdf(), settings({ text: "SAMPLE", placement: "repeat", sizeMode: "set", size: 24, pages: "range", range: "1" }));
    const copies = (await textOn(bytes, 1)).items.filter((i) => i.str === "SAMPLE");
    expect(copies.length).toBeGreaterThan(8);
  });

  it("adds a picture", async () => {
    // A 2 × 1 red PNG.
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAU/wH/yTMRMgAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const { bytes } = await addWatermark(await testPdf(), settings({ kind: "picture", pictureWidth: 40 }), { bytes: png, type: "png", name: "logo.png" });
    const doc = await PDFDocument.load(bytes);
    const images = doc.context.enumerateIndirectObjects().filter(([, o]) => (o as { dict?: PDFDict }).dict?.get(PDFName.of("Subtype")) === PDFName.of("Image"));
    expect(images.length).toBe(1);
  });

  it("explains problems in plain words", async () => {
    const input = await testPdf();
    await expect(addWatermark(input, settings({ text: "   " }))).rejects.toBeInstanceOf(WatermarkProblem);
    await expect(addWatermark(input, settings({ text: "水印" }))).rejects.toThrow(/letters can't be written/);
    await expect(addWatermark(input, settings({ kind: "picture" }))).rejects.toThrow(/Choose a picture/);
    await expect(addWatermark(input, settings({ pages: "range", range: "9" }))).rejects.toThrow(/no page 9/);
  });

  it("makes a one-page preview", async () => {
    const source = await loadForEditing(await testPdf());
    const bytes = await previewPage(source, 2, settings({ text: "PREVIEW" }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect((await textOn(bytes, 1)).items.some((i) => i.str === "PREVIEW")).toBe(true);
  });

  it("turns away a locked PDF kindly", async () => {
    // A minimal PDF whose trailer says it's encrypted.
    const locked = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n3 0 obj << /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >> endobj\ntrailer << /Root 1 0 R /Encrypt 3 0 R >>\n%%EOF\n",
    );
    await expect(loadForEditing(locked)).rejects.toBeInstanceOf(LockedPdf);
  });
});
