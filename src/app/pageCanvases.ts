/**
 * Pages already drawn, kept for a moment so a page that comes back (the next
 * page in one-page view, or one scrolled back to) shows at once instead of
 * being drawn again. A few are kept per version of the PDF; the oldest go first.
 */
import { drawPage, type PDFDocumentProxy } from "../pdf/pdfjs";

const MOST = 8;
const kept = new WeakMap<PDFDocumentProxy, Map<string, HTMLCanvasElement>>();
const drawing = new WeakMap<PDFDocumentProxy, Set<string>>();

const keyOf = (index: number, scale: number) => `${index}@${scale.toFixed(4)}`;

/** A drawing of this page at this size, if one is kept. */
export function keptCanvas(doc: PDFDocumentProxy, index: number, scale: number): HTMLCanvasElement | undefined {
  const map = kept.get(doc);
  const key = keyOf(index, scale);
  const canvas = map?.get(key);
  if (map && canvas) {
    // Most recently used goes to the back of the queue.
    map.delete(key);
    map.set(key, canvas);
  }
  return canvas;
}

/** Keep a drawing of this page at this size. */
export function keepCanvas(doc: PDFDocumentProxy, index: number, scale: number, canvas: HTMLCanvasElement): void {
  let map = kept.get(doc);
  if (!map) kept.set(doc, (map = new Map()));
  const key = keyOf(index, scale);
  map.delete(key);
  map.set(key, canvas);
  while (map.size > MOST) map.delete(map.keys().next().value as string);
}

/** Draw a page ahead of time (quietly), so it's ready when it's wanted. */
export async function drawAhead(doc: PDFDocumentProxy, index: number, scale: number): Promise<void> {
  if (index < 0 || index >= doc.numPages || kept.get(doc)?.has(keyOf(index, scale))) return;
  let busy = drawing.get(doc);
  if (!busy) drawing.set(doc, (busy = new Set()));
  const key = keyOf(index, scale);
  if (busy.has(key)) return;
  busy.add(key);
  try {
    const page = await doc.getPage(index + 1);
    const canvas = document.createElement("canvas");
    await drawPage(page, canvas, scale).promise;
    keepCanvas(doc, index, scale, canvas);
  } catch {
    // Not drawn ahead: it'll be drawn when it's shown.
  } finally {
    busy.delete(key);
  }
}
