/**
 * Printing: each chosen page is drawn as a sharp picture (150 dots per inch,
 * as Firefox's PDF viewer prints), the watermark written over it, and the
 * pictures handed to the browser's own print window in a hidden frame, each
 * on paper of its own page's size.
 */
import { layoutMark, MARK_ALPHA, MARK_COLOUR, type PrintMark } from "../model/printMark";
import type { OpenPdf } from "../model/store";
import { drawPage } from "../pdf/pdfjs";

/** Dots per inch pages are printed at. */
const PRINT_DPI = 150;

const FONT = 'Helvetica, Arial, "Liberation Sans", sans-serif';

/** Write the watermark over a page drawn on `ctx`, `w` × `h` pixels. */
export function drawMark(ctx: CanvasRenderingContext2D, mark: PrintMark, w: number, h: number): void {
  const measure = (text: string, size: number, bold: boolean) => {
    ctx.font = `${bold ? "bold " : ""}${size}px ${FONT}`;
    return ctx.measureText(text).width;
  };
  // Measured at a good size, then scaled, as text width grows in step with letter size.
  const layout = layoutMark(mark, w, h, (text, size, bold) => (measure(text, 100, bold) / 100) * size);
  if (!layout) return;
  ctx.save();
  ctx.globalAlpha = MARK_ALPHA;
  ctx.fillStyle = MARK_COLOUR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const line of layout.lines) {
    ctx.save();
    ctx.translate(line.x, line.y);
    ctx.rotate(layout.angle);
    ctx.font = `${line.bold ? "bold " : ""}${line.size}px ${FONT}`;
    ctx.fillText(line.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** Draw one page (1-based) with its watermark onto a new canvas, `dpi` dots per inch. */
export async function pageWithMark(pdf: OpenPdf, pageNumber: number, mark: PrintMark, dpi = PRINT_DPI): Promise<HTMLCanvasElement> {
  const page = await pdf.doc.getPage(pageNumber);
  const canvas = document.createElement("canvas");
  await drawPage(page, canvas, dpi / 72, 1).promise;
  const ctx = canvas.getContext("2d");
  if (ctx) drawMark(ctx, mark, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This browser couldn't make the page picture."))), "image/png"));

export class PrintCancelled extends Error {
  constructor() {
    super("Printing was cancelled.");
  }
}

/**
 * Print the chosen pages (1-based) with the watermark. `progress(done, total)`
 * is called as pages are made ready; `cancelled()` stops it between pages.
 * Resolves once the browser's print window has been shown.
 */
export async function printPages(
  pdf: OpenPdf,
  pages: number[],
  mark: PrintMark,
  progress: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<void> {
  const urls: string[] = [];
  const frame = document.createElement("iframe");
  const cleanUp = () => {
    frame.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
  try {
    for (const [i, n] of pages.entries()) {
      if (cancelled()) throw new PrintCancelled();
      progress(i, pages.length);
      urls.push(URL.createObjectURL(await toBlob(await pageWithMark(pdf, n, mark))));
    }
    if (cancelled()) throw new PrintCancelled();
    progress(pages.length, pages.length);

    // Each page on paper of its own size (in points), no margins: the page's own margins are already in it.
    const css = pages
      .map((n, i) => {
        const [w, h] = pdf.sizes[n - 1];
        return `@page p${i} { size: ${w}pt ${h}pt; margin: 0; } .p${i} { page: p${i}; width: ${w}pt; height: ${h}pt; }`;
      })
      .join("\n");
    const body = urls.map((u, i) => `<img class="p${i}" src="${u}" alt="">`).join("");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) throw new Error("This browser couldn't get the pages ready to print.");
    doc.open();
    doc.write(
      `<!doctype html><html><head><title>${escapeHtml(pdf.fileName)}</title><style>html,body{margin:0;padding:0}img{display:block;break-after:page;object-fit:fill}img:last-child{break-after:auto}${css}</style></head><body>${body}</body></html>`,
    );
    doc.close();
    await Promise.all(Array.from(doc.images).map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
    win.focus();
    win.print();
    // Keys go back to JuraPDF, not the hidden frame.
    window.focus();
    // print() returns once the print window closes (Chrome, Edge, Firefox); Safari returns at once, so keep the frame a while.
    setTimeout(cleanUp, 60_000);
  } catch (e) {
    cleanUp();
    throw e;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
