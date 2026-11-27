/**
 * JuraPDF's own additions (words, pictures, shapes, pen drawings) stay
 * changeable after they're written. Each is drawn between a pair of markers in
 * the page's instructions (`/JuraPDF12 BMC … EMC`, which other PDF readers
 * simply skip), and the page remembers what each one is (its settings as text,
 * under the page's `JuraPDFItems`). To change one, its marked instructions are
 * taken out and it's drawn again; everything else on the page stays as it was.
 */
import { PDFDocument, PDFHexString, PDFName, PDFString, beginMarkedContent, endMarkedContent, type PDFPage } from "pdf-lib";

import { readKept, keptText, type Kept } from "../model/additions";
import { splice } from "../model/contentStream";
import { contentOf } from "./pictures";
import { peekForReading } from "./watermark";

const KEY = PDFName.of("JuraPDFItems");

/** The additions page `index` (from 0) remembers, with the page they're on now. */
export function keptOn(page: PDFPage, index: number): Kept[] {
  const raw = page.node.get(KEY);
  const text = raw instanceof PDFHexString || raw instanceof PDFString ? raw.decodeText() : undefined;
  return readKept(text).map((k) => ({ ...k, item: { ...k.item, page: index } }));
}

export function setKept(page: PDFPage, kept: Kept[]): void {
  if (kept.length) page.node.set(KEY, PDFHexString.fromText(keptText(kept)));
  else page.node.delete(KEY);
}

/** A number for a new addition on the page. */
export function nextId(page: PDFPage): number {
  return Math.max(0, ...keptOn(page, 0).map((k) => k.id)) + 1;
}

export const startMark = (page: PDFPage, id: number) => page.pushOperators(beginMarkedContent(`JuraPDF${id}`));
export const endMark = (page: PDFPage) => page.pushOperators(endMarkedContent());

/** Where addition `id`'s instructions are in the page's instructions (bytes from, to), or null. */
function markedSpan(content: Uint8Array, id: number): { start: number; end: number } | null {
  let text = "";
  for (let i = 0; i < content.length; i += 8192) text += String.fromCharCode(...content.subarray(i, i + 8192));
  const open = new RegExp(`/JuraPDF${id}\\s+BMC(?![A-Za-z0-9])`).exec(text);
  if (!open) return null;
  const close = /(^|[\s\]>)])EMC(?![A-Za-z0-9])/g;
  close.lastIndex = open.index + open[0].length;
  const m = close.exec(text);
  if (!m) return null;
  return { start: open.index, end: m.index + m[0].length };
}

/** Take addition `id`'s drawing off the page (false when it isn't there any more). */
export function removeMarked(page: PDFPage, id: number): boolean {
  const content = contentOf(page);
  const span = markedSpan(content, id);
  if (!span) return false;
  const ctx = page.doc.context;
  // As a list (pdf-lib adds what's drawn next to the page's list of drawings).
  page.node.set(PDFName.of("Contents"), ctx.obj([ctx.register(ctx.flateStream(splice(content, [{ ...span, text: "" }])))]));
  return true;
}

/** Each page's additions, kept per version of the file (reading them is quick, but clicks shouldn't wait). */
const known = new WeakMap<Uint8Array, Kept[][]>();

/** Every page's additions in this version of the file. */
export async function keptIn(bytes: Uint8Array): Promise<Kept[][]> {
  const have = known.get(bytes);
  if (have) return have;
  const doc = await peekForReading(bytes);
  const all = doc ? doc.getPages().map((p, i) => keptOn(p, i)) : [];
  known.set(bytes, all);
  return all;
}

/** The additions already read for this version (for the pointer to show what can be picked), or null. */
export const keptKnown = (bytes: Uint8Array): Kept[][] | null => known.get(bytes) ?? null;

/** Remember the additions of a version just written (so the next click needn't read them). */
export function noteKept(bytes: Uint8Array, doc: PDFDocument): void {
  known.set(bytes, doc.getPages().map((p, i) => keptOn(p, i)));
}

/**
 * Page `index` on its own, as a one-page PDF, without addition `id`: shown
 * under the addition while it's being changed, so it isn't seen twice.
 */
export async function pageWithout(bytes: Uint8Array, index: number, id: number): Promise<Uint8Array | null> {
  const source = await peekForReading(bytes);
  if (!source || index < 0 || index >= source.getPageCount()) return null;
  const doc = await PDFDocument.create({ updateMetadata: false });
  const [page] = await doc.copyPages(source, [index]);
  doc.addPage(page);
  if (!removeMarked(page, id)) return null;
  return doc.save({ objectsPerTick: Infinity });
}
