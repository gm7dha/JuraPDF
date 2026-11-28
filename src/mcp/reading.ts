/**
 * Reading a PDF in the extension (Node): each page's size and turn (pdf-lib)
 * and its words (pdf.js, the legacy build, which runs in Node). The same
 * engines the app uses, so Claude sees what the user sees.
 */
import { PDFDocument } from "pdf-lib";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
// pdf.js runs its "worker" in this same process when it finds it here (no separate file to load once bundled).
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

import { normalRotation } from "../model/watermark";
import { LockedPdf } from "../pdf/watermark";

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

export interface PageFacts {
  /** As it shows, in points (after its turn). */
  width: number;
  height: number;
  /** Its turn: 0, 90, 180 or 270 degrees clockwise. */
  turn: 0 | 90 | 180 | 270;
}

/** Each page's size and turn. Throws LockedPdf for a locked PDF. */
export async function pageFacts(bytes: Uint8Array): Promise<PageFacts[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch (e) {
    throw new Error(`it couldn't be read as a PDF (${e instanceof Error ? e.message : String(e)})`);
  }
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    const turn = normalRotation(p.getRotation().angle);
    return turn % 180 ? { width: height, height: width, turn } : { width, height, turn };
  });
}

/** Is the PDF locked against changes (encrypted)? */
export async function isLocked(bytes: Uint8Array): Promise<boolean> {
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
    return false;
  } catch (e) {
    return e instanceof Error && /encrypted/i.test(e.message);
  }
}

/** Every page's bits of words as pdf.js gives them (for comparing two PDFs). */
export async function pageBits(bytes: Uint8Array): Promise<{ str: string; hasEOL: boolean }[][]> {
  let doc: PDFDocumentProxy | null = null;
  try {
    doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
    const out: { str: string; hasEOL: boolean }[][] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const bits: { str: string; hasEOL: boolean }[] = [];
      for (const item of (await page.getTextContent()).items) if ("str" in item) bits.push({ str: item.str, hasEOL: item.hasEOL });
      out.push(bits);
      page.cleanup();
    }
    return out;
  } catch (e) {
    if (e instanceof Error && /password/i.test(e.name + e.message)) throw new LockedPdf();
    throw e;
  } finally {
    void doc?.destroy();
  }
}

/** The words on the chosen pages (0 = first), as text a page at a time; pages with none give "". */
export async function pageWords(bytes: Uint8Array, pages: number[]): Promise<string[]> {
  let doc: PDFDocumentProxy | null = null;
  try {
    doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
    const out: string[] = [];
    for (const i of pages) {
      const page = await doc.getPage(i + 1);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line) lines.push(line);
      out.push(
        lines
          .map((l) => l.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join("\n"),
      );
      page.cleanup();
    }
    return out;
  } catch (e) {
    if (e instanceof Error && /password/i.test(e.name + e.message)) throw new LockedPdf();
    throw e;
  } finally {
    void doc?.destroy();
  }
}
