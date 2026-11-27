/**
 * Writing with a font that's already in the PDF (pdf-lib), so changed words
 * keep the look they had. Which letters it can write comes from the font's
 * own list (src/model/fontCodes.ts); when it lacks one, the caller falls back
 * to the nearest built-in font.
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, StandardFontEmbedder, StandardFonts, decodePDFRawStream, type PDFPage } from "pdf-lib";

import { peekForReading } from "./watermark";
import { readCidWidths, readToUnicode, winAnsiCodes, type CodeMap } from "../model/fontCodes";

/** A font of the page's, ready to write with. */
export interface PageFont {
  /** Its name in the page's list of fonts (e.g. "F1"). */
  key: string;
  codes: CodeMap;
  /** How wide some letters are at a letter size, in points (null when a letter isn't there). */
  widthOf(text: string, size: number): number;
}

const STANDARD = new Set<string>(Object.values(StandardFonts));

function streamText(page: PDFPage, ref: unknown): string | null {
  const obj = ref instanceof PDFRef ? page.doc.context.lookup(ref) : ref;
  if (!(obj instanceof PDFStream)) return null;
  const bytes = obj instanceof PDFRawStream ? decodePDFRawStream(obj).decode() : (obj as unknown as { getContents(): Uint8Array }).getContents();
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

const numbers = (arr: PDFArray | undefined): (number | number[])[] =>
  arr?.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : v instanceof PDFArray ? v.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)) : 0)) ?? [];

/** The name a font goes by in the PDF (with any "ABCDEF+" in front). */
const baseOf = (dict: PDFDict) => dict.lookupMaybe(PDFName.of("BaseFont"), PDFName)?.decodeText() ?? "";

/** The page's font called `base` (as pdf.js reports it), ready to write with, or null when it can't be written with. */
export function pageFont(page: PDFPage, base: string): PageFont | null {
  const fonts = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (!fonts) return null;
  const strip = (n: string) => n.replace(/^[A-Z]{6}\+/, "");
  const entries = fonts.entries().map(([k, v]) => [k, v instanceof PDFRef ? page.doc.context.lookup(v) : v] as const);
  const found = entries.find(([, d]) => d instanceof PDFDict && baseOf(d) === base) ?? entries.find(([, d]) => d instanceof PDFDict && strip(baseOf(d)) === strip(base));
  if (!found || !(found[1] instanceof PDFDict)) return null;
  const [key, dict] = found as readonly [PDFName, PDFDict];
  try {
    return readFont(page, key.decodeText(), dict);
  } catch {
    return null;
  }
}

function readFont(page: PDFPage, key: string, dict: PDFDict): PageFont | null {
  const subtype = dict.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
  const toUnicode = streamText(page, dict.get(PDFName.of("ToUnicode")));
  if (subtype === "Type0") {
    // Two-byte codes that are the glyph numbers themselves ("Identity"): the usual way for fonts carried in a PDF.
    if (dict.lookupMaybe(PDFName.of("Encoding"), PDFName)?.decodeText() !== "Identity-H" || !toUnicode) return null;
    const codes = readToUnicode(toUnicode, 2);
    const kid = dict.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray)?.lookup(0, PDFDict);
    const widths = readCidWidths(numbers(kid?.lookupMaybe(PDFName.of("W"), PDFArray)));
    const dw = kid?.lookupMaybe(PDFName.of("DW"), PDFNumber)?.asNumber() ?? 1000;
    return {
      key,
      codes,
      widthOf: (text, size) => [...text].reduce((t, ch) => t + (widths.get(parseInt(codes.get(ch) ?? "0", 16)) ?? dw), 0) * (size / 1000),
    };
  }
  if (subtype !== "Type1" && subtype !== "TrueType" && subtype !== "MMType1") return null;
  const base = baseOf(dict);
  const encoding = dict.get(PDFName.of("Encoding"));
  const named = encoding instanceof PDFName ? encoding.decodeText() : null;
  let codes: CodeMap;
  if (toUnicode) codes = readToUnicode(toUnicode, 1);
  else if (named === "WinAnsiEncoding" || (!encoding && STANDARD.has(base) && base !== "Symbol" && base !== "ZapfDingbats")) codes = winAnsiCodes();
  else return null;
  const first = dict.lookupMaybe(PDFName.of("FirstChar"), PDFNumber)?.asNumber() ?? 0;
  const list = numbers(dict.lookupMaybe(PDFName.of("Widths"), PDFArray)) as number[];
  const standard = STANDARD.has(base) ? StandardFontEmbedder.for(base as unknown as Parameters<typeof StandardFontEmbedder.for>[0]) : null;
  if (!list.length && !standard) return null;
  // A letter whose width is 0 isn't in the font (fonts carried in PDFs often keep only the letters used).
  if (list.length) for (const [ch, hex] of [...codes]) if (!(list[parseInt(hex, 16) - first] > 0) && ch !== " ") codes.delete(ch);
  return {
    key,
    codes,
    widthOf: (text, size) =>
      list.length ? [...text].reduce((t, ch) => t + (list[parseInt(codes.get(ch) ?? "0", 16) - first] ?? 0), 0) * (size / 1000) : (standard?.widthOfTextAtSize(text, size) ?? 0),
  };
}

/** The letters the page's font `base` can write (null when it can't be written with at all). */
export async function fontLetters(bytes: Uint8Array, index: number, base: string): Promise<Set<string> | null> {
  const doc = await peekForReading(bytes);
  if (!doc || index < 0 || index >= doc.getPageCount()) return null;
  const font = pageFont(doc.getPage(index), base);
  return font ? new Set(font.codes.keys()) : null;
}
