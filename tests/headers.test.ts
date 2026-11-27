import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { DEFAULT_HEADERS, cleanHeaders, fillCodes, headerPages, headersLabel, linesFor, type HeaderSettings } from "../src/model/headers";
import { HeaderProblem, addHeaders, headersIn, previewHeaders, removeHeaders } from "../src/pdf/headers";

const STANDARD_FONTS = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;

const settings = (over: Partial<HeaderSettings> = {}, text: Partial<HeaderSettings["text"]> = {}): HeaderSettings => ({
  ...DEFAULT_HEADERS,
  ...over,
  text: { ...DEFAULT_HEADERS.text, ...text },
});

/** Three A4 pages, the third turned a quarter (shows landscape). Each says "Body N". */
async function testPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([595, 842]);
    if (i === 2) page.setRotation(degrees(90));
    page.drawText(`Body ${i + 1}`, { x: 100, y: 400, size: 20, font });
  }
  return doc.save();
}

/** The bits of text on page `n` with where they start as shown (y up from the bottom), and the page's shown size. */
async function textOn(bytes: Uint8Array, n: number) {
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items
    .filter((it): it is typeof it & { str: string; transform: number[]; width: number } => "str" in it && it.str.trim() !== "")
    .map((it) => {
      const [x, yDown] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      return { str: it.str, x, y: vp.height - yDown, width: it.width };
    });
  await doc.destroy();
  return { items, width: vp.width, height: vp.height };
}

describe("header and footer words", () => {
  it("fills in the page number, count, date and file name", () => {
    const f = { number: 7, total: 12, date: "27 Nov 2026", file: "Report" };
    expect(fillCodes("Page {page} of {pages}", f, 0)).toBe("Page 7 of 12");
    expect(fillCodes("ABC{PAGE}", f, 6)).toBe("ABC000007");
    expect(fillCodes("{file} · {date}", f, 0)).toBe("Report · 27 Nov 2026");
    expect(fillCodes("{nothing}", f, 0)).toBe("{nothing}");
  });

  it("chooses pages and puts each line in its spot", () => {
    expect(headerPages(settings(), 3)).toEqual({ pages: [1, 2, 3] });
    expect(headerPages(settings({ pages: "range", range: "2-" }), 3)).toEqual({ pages: [2, 3] });
    expect(headerPages(settings({ pages: "range", range: "" }), 3)).toHaveProperty("error");
    const lines = linesFor(settings({ margin: 20 }, { topLeft: "L", topRight: "R" }), { number: 1, total: 1, date: "", file: "" }, 600, 800, (t) => t.length * 10, 8);
    expect(lines).toEqual([
      { slot: "topLeft", text: "L", x: 20, y: 772 },
      { slot: "topRight", text: "R", x: 570, y: 772 },
      { slot: "bottomCentre", text: "Page 1 of 1", x: 245, y: 20 },
    ]);
  });

  it("names what's added, and tidies odd settings", () => {
    expect(headersLabel(settings())).toBe("page numbers");
    expect(headersLabel(settings({}, { topLeft: "Draft" }))).toBe("a header and footer");
    expect(headersLabel(settings({}, { bottomCentre: "", topLeft: "Draft" }))).toBe("a header");
    const clean = cleanHeaders({ size: 999, font: "Comic", colour: "red", text: { topLeft: "Hi" }, digits: 6.4 });
    expect(clean).toMatchObject({ size: 72, font: "Helvetica", colour: DEFAULT_HEADERS.colour, digits: 6 });
    expect(clean.text).toMatchObject({ topLeft: "Hi", bottomCentre: "" });
  });
});

describe("writing headers and footers", () => {
  it("puts page numbers at the bottom middle of every page, turned pages too", async () => {
    const out = await addHeaders(await testPdf(), settings(), "Report.pdf", "27 Nov 2026");
    expect(out.pages).toEqual([1, 2, 3]);
    for (const n of [1, 2, 3]) {
      const { items, width } = await textOn(out.bytes, n);
      const num = items.find((i) => i.str.startsWith("Page "))!;
      expect(num.str).toBe(`Page ${n} of 3`);
      expect(num.x + num.width / 2).toBeCloseTo(width / 2, 0);
      expect(num.y).toBeCloseTo(DEFAULT_HEADERS.margin, 0);
    }
  });

  it("counts from a chosen number, with zeros, on chosen pages, and replaces what was there", async () => {
    const first = await addHeaders(await testPdf(), settings(), "Report.pdf", "");
    const out = await addHeaders(first.bytes, settings({ pages: "range", range: "2-3", startAt: 41, digits: 6 }, { bottomCentre: "", topRight: "ACME{page}" }), "Report.pdf", "");
    expect(out.pages).toEqual([2, 3]);
    const one = await textOn(out.bytes, 1);
    expect(one.items.map((i) => i.str)).toEqual(["Body 1"]);
    const two = await textOn(out.bytes, 2);
    const mark = two.items.find((i) => i.str.startsWith("ACME"))!;
    expect(mark.str).toBe("ACME000041");
    expect(mark.x + mark.width).toBeCloseTo(two.width - DEFAULT_HEADERS.margin, 0);
    expect(mark.y).toBeGreaterThan(two.height - DEFAULT_HEADERS.margin - 12);
    expect((await textOn(out.bytes, 3)).items.map((i) => i.str)).toContain("ACME000042");
    expect((await headersIn(out.bytes))?.text.topRight).toBe("ACME{page}");
  });

  it("takes them off again, leaving the pages as they were", async () => {
    const out = await addHeaders(await testPdf(), settings({}, { topLeft: "{file}" }), "Report.pdf", "");
    expect((await textOn(out.bytes, 1)).items.map((i) => i.str)).toContain("Report");
    const off = await removeHeaders(out.bytes);
    expect((await textOn(off, 1)).items.map((i) => i.str)).toEqual(["Body 1"]);
    expect(await headersIn(off)).toBeNull();
    await expect(removeHeaders(off)).rejects.toThrow(HeaderProblem);
  });

  it("says kindly what can't be done", async () => {
    const pdf = await testPdf();
    await expect(addHeaders(pdf, settings({}, { bottomCentre: "" }), "x.pdf", "")).rejects.toThrow(/words/);
    await expect(addHeaders(pdf, settings({}, { topLeft: "日本" }), "x.pdf", "")).rejects.toThrow(/can't be written/);
    await expect(addHeaders(pdf, settings({ pages: "range", range: "9" }), "x.pdf", "")).rejects.toThrow(HeaderProblem);
  });

  it("previews one page numbered as in the whole PDF", async () => {
    const source = await PDFDocument.load(await testPdf());
    const one = await previewHeaders(source, 2, settings(), "Report.pdf", "");
    expect((await textOn(one, 1)).items.map((i) => i.str)).toContain("Page 2 of 3");
  });
});
