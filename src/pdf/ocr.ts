/**
 * Reading the words in a picture of a page, with Tesseract (free and open
 * source, Apache 2.0), which runs in a background worker. Its files are part of
 * JuraPDF (copied into the build under ocr/ by vite.config.ts), fetched the
 * first time words are read and kept, so it works offline after that.
 */
import type { FoundWord } from "../model/ocr";

type Worker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

let ready: Promise<Worker> | null = null;
let onProgress: ((share: number, getting: boolean) => void) | null = null;

function reader(): Promise<Worker> {
  ready ??= (async () => {
    const { createWorker, OEM } = await import("tesseract.js");
    const files = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;
    return createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: `${files}worker.min.js`,
      corePath: files,
      langPath: files,
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => onProgress?.(m.progress, !m.status.startsWith("recognizing")),
    });
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** The words in a picture, with where each is (in its pixels). `progress` hears how far along it is (0–1). */
export async function readPicture(canvas: HTMLCanvasElement, progress?: (share: number, getting: boolean) => void): Promise<FoundWord[]> {
  onProgress = progress ?? null;
  try {
    const worker = await reader();
    const { data } = await worker.recognize(canvas);
    return (data.words ?? []).map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox }));
  } finally {
    onProgress = null;
  }
}
