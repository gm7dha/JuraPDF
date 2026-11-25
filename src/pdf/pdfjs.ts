/**
 * Reading and drawing PDFs, with Mozilla's pdf.js (the engine inside
 * Firefox's PDF viewer). It does the heavy work in a background worker so
 * the window never freezes.
 */
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "virtual:pdfjs-worker-url";

import type { Size } from "../model/zoom";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

/** The PDF needs a password (`wrong`: the one given didn't work). */
export class NeedsPassword extends Error {
  constructor(public wrong: boolean) {
    super(wrong ? "That password didn't open it." : "This PDF is protected by a password.");
  }
}

/** One background worker shared by every PDF opened (each version kept for Undo is one). */
let worker: pdfjs.PDFWorker | null = null;

/** Open a PDF from its bytes. The bytes are copied, so the caller's copy stays usable. */
export async function loadPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const base = import.meta.env.BASE_URL;
  worker ??= new pdfjs.PDFWorker();
  const task = pdfjs.getDocument({
    worker,
    data: bytes.slice(),
    password,
    // Character maps (for Chinese, Japanese and Korean text) and the standard fonts,
    // served with the app (see vite.config.ts) so they also work offline.
    cMapUrl: `${base}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
    isEvalSupported: false,
    // Let Chrome and Edge unpack JPG pictures themselves: far quicker for scanned pages.
    // (The worker is changed so JPGs with a "which way up" note still go the slow, careful way: see vite.config.ts.)
    isImageDecoderSupported: true,
  });
  try {
    return await task.promise;
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") {
      throw new NeedsPassword((e as Error & { code?: number }).code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    }
    throw e;
  }
}

/** Every page's size in points, as it shows (turned pages already turned). */
export async function pageSizes(doc: PDFDocumentProxy): Promise<Size[]> {
  // Asked for all at once: the background worker answers them in a stream rather than one round trip each.
  const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
  return pages.map((page) => {
    const vp = page.getViewport({ scale: 1 });
    return [vp.width, vp.height];
  });
}

/** Largest canvas we draw, in pixels (big canvases crash some browsers, Safari especially). */
const MAX_PIXELS = 16_000_000;

/**
 * Draw a page onto a canvas, `cssScale` CSS pixels per point, sharp on
 * high-resolution screens. Returns the task so it can be cancelled.
 */
export function drawPage(page: PDFPageProxy, canvas: HTMLCanvasElement, cssScale: number, pixelRatio = window.devicePixelRatio || 1): RenderTask {
  const viewport = page.getViewport({ scale: cssScale });
  let ratio = pixelRatio;
  if (viewport.width * viewport.height * ratio * ratio > MAX_PIXELS) ratio = Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height));
  canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
  canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("This browser couldn't draw the page.");
  return page.render({
    canvasContext: ctx,
    viewport,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
  });
}

/** Lay the page's words over the drawing (invisible) so they can be selected, copied and found with Ctrl+F. */
export function drawTextLayer(page: PDFPageProxy, container: HTMLElement, cssScale: number): { cancel(): void; promise: Promise<void> } {
  const viewport = page.getViewport({ scale: cssScale });
  container.replaceChildren();
  const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
  // Handed back at once, so a page whose PDF changes mid-way can stop it before its words land.
  return { cancel: () => layer.cancel(), promise: layer.render() };
}

/**
 * Keep only the ink: anything pale (a see-through watermark, a highlight, a
 * coloured background) turns white, the rest grey to black, so faint marks
 * don't muddle the words when they're read.
 */
function inkOnly(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const light = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const v = light > 165 ? 255 : Math.round(light * 0.6);
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * A page drawn finely for reading the words in its pictures (at `scale`
 * pixels per point, kept under the drawing limit), with the boxes of the words
 * it already has (points from its top-left as shown), so those aren't read twice.
 */
export async function pageForReading(doc: PDFDocumentProxy, index: number, scale: number): Promise<{ canvas: HTMLCanvasElement; scale: number; words: { x: number; y: number; width: number; height: number }[] }> {
  const page = await doc.getPage(index + 1);
  const unit = page.getViewport({ scale: 1 });
  const fitted = Math.min(scale, Math.sqrt(MAX_PIXELS / (unit.width * unit.height)));
  const canvas = document.createElement("canvas");
  await drawPage(page, canvas, fitted, 1).promise;
  inkOnly(canvas);
  const words: { x: number; y: number; width: number; height: number }[] = [];
  for (const item of (await page.getTextContent()).items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const [a, b, , , e, f] = pdfjs.Util.transform(unit.transform, item.transform);
    // Only words running across the page as shown: a slanted watermark's box would cover half the page.
    if (Math.abs(b) > Math.abs(a) * 0.05 || a <= 0) continue;
    const height = Math.hypot(a, b) || item.height;
    words.push({ x: e, y: f - height, width: item.width, height: height * 1.2 });
  }
  return { canvas, scale: fitted, words };
}

/** A run of words on a page as it shows (points from its top-left), for changing them. */
export interface WordRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where the letters sit, and their size. */
  baseline: number;
  size: number;
  /** "serif", "sans-serif" or "monospace", as near as can be told. */
  family: string;
}

/** The runs of words on a page that run straight across it as shown. */
export async function wordRuns(doc: PDFDocumentProxy, index: number): Promise<WordRun[]> {
  const page = await doc.getPage(index + 1);
  const unit = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const out: WordRun[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const [a, b, , , e, f] = pdfjs.Util.transform(unit.transform, item.transform);
    if (Math.abs(b) > Math.abs(a) * 0.05 || a <= 0) continue;
    const size = Math.hypot(a, b);
    const style = content.styles[item.fontName];
    const ascent = style?.ascent && style.ascent > 0.5 ? style.ascent : 0.8;
    const descent = style?.descent && style.descent < 0 ? -style.descent : 0.2;
    out.push({ text: item.str, x: e, y: f - ascent * size, width: item.width, height: (ascent + descent) * size, baseline: f, size, family: style?.fontFamily ?? "sans-serif" });
  }
  return out;
}

/** A page's words in reading order, each marked where its line ends. */
export async function pageTextBits(doc: PDFDocumentProxy, index: number): Promise<{ str: string; hasEOL: boolean }[]> {
  const page = await doc.getPage(index + 1);
  const content = await page.getTextContent();
  return content.items.filter((i) => "str" in i).map((i) => ({ str: (i as { str: string }).str, hasEOL: !!(i as { hasEOL?: boolean }).hasEOL }));
}

/** A page as a picture file (PNG or JPG) at `dpi` dots to the inch. */
export async function pagePicture(doc: PDFDocumentProxy, index: number, dpi: number, type: "png" | "jpg"): Promise<Uint8Array> {
  const page = await doc.getPage(index + 1);
  const canvas = document.createElement("canvas");
  const unit = page.getViewport({ scale: 1 });
  const scale = Math.min(dpi / 72, Math.sqrt(MAX_PIXELS / (unit.width * unit.height)));
  // Drawn on white (pages are paper; a PNG would otherwise keep see-through gaps).
  await drawPage(page, canvas, scale, 1).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type === "png" ? "image/png" : "image/jpeg", 0.92));
  if (!blob) throw new Error("This browser couldn't make the picture.");
  return new Uint8Array(await blob.arrayBuffer());
}

/** True when an error is just a drawing that was stopped on purpose (the page scrolled away or the zoom changed). */
export function isCancelled(e: unknown): boolean {
  return e instanceof Error && e.name === "RenderingCancelledException";
}
