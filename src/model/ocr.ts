/**
 * Reading words in pictures (scans, photos): which of the words found are
 * worth adding to the page, and where. Positions are points "as shown" from
 * the page's top-left, like the rest of src/model/additions.ts.
 */
import type { Rect } from "./additions";

/** A word the reader found in the picture of a page, in its pixels. */
export interface FoundWord {
  text: string;
  /** How sure the reader is, 0–100. */
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** A word to write onto the page (invisibly), in points. */
export interface HiddenWord extends Rect {
  text: string;
  /** For words that aren't level (sideways or upside down as shown): where the baseline starts, its turn and size. */
  along?: { x: number; y: number; turn: number; length: number; size: number };
}

/** Words the reader is less sure of than this are left out (they'd mostly be specks and smudges). */
export const MIN_CONFIDENCE = 45;

/** How finely a page is drawn for reading: 300 dots to the inch, about what a scanner gives. */
export const READING_SCALE = 300 / 72;

/** The share of `a` that `b` covers. */
function covered(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(1e-6, a.width * a.height) : 0;
}

/**
 * The words to add: found words (drawn at `scale` pixels per point) the
 * reader is sure enough of, that aren't already words on the page (`existing`,
 * the page's own words, which can be picked already).
 */
export function wordsToAdd(found: FoundWord[], existing: Rect[], scale: number, minConfidence = MIN_CONFIDENCE): HiddenWord[] {
  const out: HiddenWord[] = [];
  for (const w of found) {
    const text = w.text.trim();
    if (!text || w.confidence < minConfidence) continue;
    const box = { x: w.bbox.x0 / scale, y: w.bbox.y0 / scale, width: (w.bbox.x1 - w.bbox.x0) / scale, height: (w.bbox.y1 - w.bbox.y0) / scale };
    if (box.width < 1 || box.height < 1) continue;
    // A word that's mostly letters of one sort or other, not a lone stray mark.
    if (text.length === 1 && !/[\p{L}\p{N}]/u.test(text)) continue;
    if (existing.some((e) => covered(box, e) > 0.4)) continue;
    out.push({ text, ...box });
  }
  return out;
}

/** "Found 52 words on page 3" and the like. */
export function readingSummary(perPage: Map<number, number>): string {
  const total = [...perPage.values()].reduce((a, b) => a + b, 0);
  const pages = [...perPage.keys()].map((p) => p + 1);
  const where = pages.length === 1 ? `page ${pages[0]}` : `${pages.length} pages`;
  if (!total) return `No words found in the pictures on ${where}.`;
  return `Found ${total} ${total === 1 ? "word" : "words"} in the pictures on ${where}. They can now be picked, copied and found with Ctrl+F.`;
}
