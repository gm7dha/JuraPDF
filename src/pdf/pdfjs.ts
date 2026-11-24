/**
 * Reading and drawing PDFs, with Mozilla's pdf.js (the engine inside
 * Firefox's PDF viewer). It does the heavy work in a background worker so
 * the window never freezes.
 */
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

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
  const sizes: Size[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push([vp.width, vp.height]);
  }
  return sizes;
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
export async function drawTextLayer(page: PDFPageProxy, container: HTMLElement, cssScale: number): Promise<pdfjs.TextLayer> {
  const viewport = page.getViewport({ scale: cssScale });
  container.replaceChildren();
  const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
  await layer.render();
  return layer;
}

/** True when an error is just a drawing that was stopped on purpose (the page scrolled away or the zoom changed). */
export function isCancelled(e: unknown): boolean {
  return e instanceof Error && e.name === "RenderingCancelledException";
}
