/**
 * Writing headers, footers and page numbers into the pages (pdf-lib). They're
 * drawn between `/JuraPDFHeaders BMC … EMC` markers so they can be taken off or
 * replaced later, and the settings are remembered in the PDF so the Headers
 * window opens with them again.
 */
import { PDFDocument, PDFHexString, PDFName, PDFString, beginMarkedContent, degrees, endMarkedContent, rgb } from "pdf-lib";

import { cleanHeaders, hasWords, headerPages, linesFor, type HeaderSettings } from "../model/headers";
import { hexToRgb, shownSize, toPageSpace } from "../model/watermark";
import { removeMarked } from "./items";
import { arrange, existingContents, FONTS, frameOf, loadForEditing, peekForReading, saveEdited } from "./watermark";

export class HeaderProblem extends Error {}

const TAG = "JuraPDFHeaders";
const KEY = PDFName.of("JuraPDFHeaders");

/** Take off every page's headers and footers that JuraPDF wrote; true when there were some. */
function takeOff(doc: PDFDocument): boolean {
  let any = false;
  for (const page of doc.getPages()) while (removeMarked(page, TAG)) any = true;
  return any;
}

/** The settings last used on this PDF, if JuraPDF put headers or footers on it. */
export async function headersIn(bytes: Uint8Array): Promise<HeaderSettings | null> {
  const doc = await peekForReading(bytes);
  const raw = doc?.catalog.get(KEY);
  if (!(raw instanceof PDFHexString || raw instanceof PDFString)) return null;
  try {
    return cleanHeaders(JSON.parse(raw.decodeText()));
  } catch {
    return null;
  }
}

/** Write headers and footers onto the chosen pages (replacing any JuraPDF put on before). */
async function write(doc: PDFDocument, s: HeaderSettings, fileName: string, date: string): Promise<number[]> {
  if (!hasWords(s)) throw new HeaderProblem("Type the words for at least one spot first (for page numbers, {page}).");
  const chosen = headerPages(s, doc.getPageCount());
  if ("error" in chosen) throw new HeaderProblem(chosen.error);
  const font = await doc.embedFont(FONTS[s.font]);
  const [r, g, b] = hexToRgb(s.colour);
  const ascent = font.heightAtSize(s.size, { descender: false });
  const file = fileName.replace(/\.pdf$/i, "");
  const total = s.startAt + chosen.pages.length - 1;
  const pages = doc.getPages();
  takeOff(doc);
  chosen.pages.forEach((n, k) => {
    const page = pages[n - 1];
    if (!page) return;
    const frame = frameOf(page);
    const [pw, ph] = shownSize(frame);
    const lines = linesFor(s, { number: s.startAt + k, total, date, file }, pw, ph, (t) => {
      try {
        return font.widthOfTextAtSize(t, s.size);
      } catch {
        throw new HeaderProblem(`Some letters in “${t}” can't be written with the built-in fonts (they cover English and most European letters).`);
      }
    }, ascent);
    const before = existingContents(page);
    page.pushOperators(beginMarkedContent(TAG));
    for (const line of lines) {
      const at = toPageSpace(frame, line.x, line.y, 0);
      page.drawText(line.text, { x: at.x, y: at.y, size: s.size, font, color: rgb(r, g, b), rotate: degrees(at.angle) });
    }
    page.pushOperators(endMarkedContent());
    arrange(page, before, false);
  });
  doc.catalog.set(KEY, PDFHexString.fromText(JSON.stringify(s)));
  return chosen.pages;
}

/** The PDF with headers, footers or page numbers on (one new version), and the pages they went on. */
export async function addHeaders(bytes: Uint8Array, s: HeaderSettings, fileName: string, date: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; pages: number[] }> {
  const doc = await loadForEditing(bytes);
  const pages = await write(doc, s, fileName, date);
  return { bytes: await saveEdited(doc), pages };
}

/** The PDF without the headers and footers JuraPDF put on. */
export async function removeHeaders(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  if (!takeOff(doc)) throw new HeaderProblem("This PDF has no headers or footers added by JuraPDF to take off.");
  doc.catalog.delete(KEY);
  return saveEdited(doc);
}

/** One page (from 1) on its own with the headers on, for the preview. */
export async function previewHeaders(source: PDFDocument, n: number, s: HeaderSettings, fileName: string, date: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [page] = await doc.copyPages(source, [n - 1]);
  doc.addPage(page);
  takeOff(doc);
  if (hasWords(s)) {
    // Numbered as it will be in the whole PDF.
    const chosen = headerPages(s, source.getPageCount());
    const k = "pages" in chosen ? chosen.pages.indexOf(n) : -1;
    if (k >= 0) {
      const one = { ...s, pages: "all" as const, startAt: s.startAt + k };
      const total = s.startAt + ("pages" in chosen ? chosen.pages.length : 1) - 1;
      // {pages} is shown as in the whole PDF.
      const text = Object.fromEntries(Object.entries(s.text).map(([slot, t]) => [slot, t.replace(/\{pages\}/gi, String(total).padStart(s.digits, "0"))])) as HeaderSettings["text"];
      await write(doc, { ...one, text }, fileName, date);
    }
  }
  return doc.save();
}
