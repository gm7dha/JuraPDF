/**
 * Making the open PDF smaller (one step in Undo): the browser draws the
 * pictures at their new size and saves them as JPGs; the rest is in
 * src/pdf/compress.ts.
 */
import { hasCameraNotes, savingLabel, type Squeeze } from "../model/compress";
import { sizeLabel } from "../model/pdfFile";
import { useStore } from "../model/store";
import { squeeze, type Painter, type Picture } from "../pdf/compress";
import { LockedPdf } from "../pdf/watermark";
import { applyChange } from "./editing";

function canvasOf(width: number, height: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser couldn't draw the picture.");
  return ctx;
}

async function source(p: Picture): Promise<ImageBitmap> {
  if (p.kind === "jpg") {
    if (hasCameraNotes(p.bytes)) throw new Error("left as it is");
    return createImageBitmap(new Blob([p.bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }));
  }
  return createImageBitmap(new ImageData(p.rgba as Uint8ClampedArray<ArrayBuffer>, p.width, p.height));
}

const painter: Painter = {
  async pixels(p, width, height) {
    const bitmap = await source(p);
    try {
      // Bitmaps the browser had to make smaller on reading would be the wrong size: leave such pictures alone.
      if (bitmap.width !== p.width || bitmap.height !== p.height) throw new Error("left as it is");
      const ctx = canvasOf(width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      return ctx.getImageData(0, 0, width, height).data;
    } finally {
      bitmap.close();
    }
  },
  async jpg(rgba, width, height, quality) {
    const ctx = canvasOf(width, height);
    ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    const blob = await new Promise<Blob | null>((done) => ctx.canvas.toBlob(done, "image/jpeg", quality));
    if (!blob) throw new Error("This browser couldn't save the picture.");
    return new Uint8Array(await blob.arrayBuffer());
  },
};

let busy = false;

/** Make the PDF smaller. Says how it went; true when the PDF changed. */
export async function makeSmaller(level: Squeeze, progress: (done: number) => void): Promise<boolean> {
  const s = useStore.getState();
  const pdf = s.pdf;
  if (!pdf || busy) return false;
  busy = true;
  try {
    const before = pdf.bytes.length;
    const out = await squeeze(pdf.bytes, level, painter, progress);
    if (useStore.getState().pdf !== pdf) return false;
    if (out.bytes.length >= before * 0.99) {
      s.showToast(`This PDF couldn't be made any smaller here: its pictures are already small or stored in a way that's left alone (${sizeLabel(before)}).`, "info");
      return false;
    }
    await applyChange(out.bytes, "make the PDF smaller");
    useStore.getState().showToast(`Made smaller: ${savingLabel(before, out.bytes.length, sizeLabel)}. Save to keep it.`, "success");
    return true;
  } catch (e) {
    s.showToast(e instanceof LockedPdf ? "This PDF is locked against changes, so it can't be made smaller here." : `Couldn't make it smaller: ${e instanceof Error ? e.message : String(e)}`, "error");
    return false;
  } finally {
    busy = false;
  }
}
