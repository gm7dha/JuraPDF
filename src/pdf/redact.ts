/**
 * Blacking out for good (redaction), with pdf-lib. Each page with marks is
 * replaced by a picture of itself with black boxes drawn on (made in the
 * browser with pdf.js), so nothing under a box survives: not the words, not
 * pictures, not anything hidden. The page's other words are written back
 * invisibly so they can still be picked and found, and notes, links and form
 * boxes under a mark are taken off.
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, degrees } from "pdf-lib";

import type { KeptWords, Mark } from "../model/redact";
import { overlaps } from "../model/redact";
import { shownSize, toPageSpace, type PageFrame } from "../model/watermark";
import { removeField, writeHiddenWords } from "./additions";
import { setKept } from "./items";
import { frameOf, loadForEditing, saveEdited } from "./watermark";

export class RedactProblem extends Error {}

export interface BlackedOutPage {
  /** The page (0 = first). */
  page: number;
  /** The page as a JPG picture with the black boxes on. */
  picture: Uint8Array;
  marks: Mark[];
  /** The page's words outside the marks, to write back invisibly. */
  words: KeptWords[];
}

/** A box as shown (from the top-left) in the page's own space (x, y up, as PDF rectangles are). */
function inPageSpace(frame: PageFrame, m: { x: number; y: number; width: number; height: number }) {
  const [, h] = shownSize(frame);
  const a = toPageSpace(frame, m.x, h - m.y, 0);
  const b = toPageSpace(frame, m.x + m.width, h - (m.y + m.height), 0);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** The rectangle of an annotation (note, link, form box), in the page's own space. */
function rectOf(annot: PDFDict) {
  const r = annot.lookup(PDFName.of("Rect"));
  if (!(r instanceof PDFArray) || r.size() < 4) return null;
  const n = [0, 1, 2, 3].map((i) => {
    const v = r.lookup(i);
    return v instanceof PDFNumber ? v.asNumber() : NaN;
  });
  if (n.some(Number.isNaN)) return null;
  return { x: Math.min(n[0], n[2]), y: Math.min(n[1], n[3]), width: Math.abs(n[2] - n[0]), height: Math.abs(n[3] - n[1]) };
}

/** The PDF with these pages blacked out for good (one new version). */
export async function blackOut(bytes: Uint8Array, pages: readonly BlackedOutPage[]): Promise<Uint8Array<ArrayBuffer>> {
  if (!pages.length) throw new RedactProblem("Mark something to black out first.");
  const doc = await loadForEditing(bytes);
  const all = doc.getPages();
  const ctx = doc.context;
  const form = doc.getForm();
  for (const one of pages) {
    const p = all[one.page];
    if (!p) continue;
    const frame = frameOf(p);
    const [w, h] = shownSize(frame);
    const marks = one.marks.map((m) => inPageSpace(frame, m));

    // Notes, links and form boxes under a mark go (a form box's answer could tell what was under it).
    const annots = p.node.lookup(PDFName.of("Annots"));
    if (annots instanceof PDFArray) {
      const gone = new Set<PDFDict>();
      for (let i = 0; i < annots.size(); i++) {
        const a = annots.lookup(i);
        const r = a instanceof PDFDict ? rectOf(a) : null;
        if (a instanceof PDFDict && r && marks.some((m) => overlaps(r, m))) gone.add(a);
      }
      for (const field of form.getFields()) {
        const widgets = field.acroField.getWidgets();
        if (widgets.some((wd) => gone.has(wd.dict))) removeField(doc, field.getName());
      }
      for (let i = annots.size() - 1; i >= 0; i--) if (gone.has(annots.lookup(i) as PDFDict)) annots.remove(i);
    }

    // Everything the page drew goes; the picture of it, with the black boxes, takes its place.
    p.node.set(PDFName.of("Resources"), ctx.obj({ Font: {}, XObject: {}, ExtGState: {} }));
    p.node.set(PDFName.of("Contents"), ctx.obj([]));
    p.node.delete(PDFName.of("Thumb"));
    p.node.delete(PDFName.of("PieceInfo"));
    Object.assign(p, { contentStream: undefined, contentStreamRef: undefined });
    setKept(p, []);
    let image;
    try {
      image = await doc.embedJpg(one.picture);
    } catch {
      throw new RedactProblem("The page couldn't be redrawn to black it out.");
    }
    const at = toPageSpace(frame, 0, 0, 0);
    p.drawImage(image, { x: at.x, y: at.y, width: w, height: h, rotate: degrees(at.angle) });
    await writeHiddenWords(doc, p, one.words);
  }
  return saveEdited(doc);
}
