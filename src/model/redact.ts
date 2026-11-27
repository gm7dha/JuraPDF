/**
 * Blacking out (redaction), pure parts: the places marked to black out, in
 * points from the page's top-left as shown, and which of a page's words are
 * kept (findable) once the page is redrawn with black boxes over the marks.
 */

/** A place marked to black out. */
export interface Mark {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A bit of a page's words with its box as shown (from pdf.js; level ones only). */
export interface TextBox {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A word to write back invisibly (so the page's other words can still be picked and found). */
export interface KeptWords {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

type Box = { x: number; y: number; width: number; height: number };

/** Do two boxes overlap (touching edges don't count)? */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** A box from two corners, kept on the page; null when it's too small to mean anything. */
export function markFrom(page: number, x1: number, y1: number, x2: number, y2: number, pageW: number, pageH: number): Mark | null {
  const cx = (v: number) => Math.min(pageW, Math.max(0, v));
  const cy = (v: number) => Math.min(pageH, Math.max(0, v));
  const x = Math.min(cx(x1), cx(x2));
  const y = Math.min(cy(y1), cy(y2));
  const width = Math.abs(cx(x2) - cx(x1));
  const height = Math.abs(cy(y2) - cy(y1));
  return width < 2 || height < 2 ? null : { page, x, y, width, height };
}

/** The box of letters `from` to `to` of a bit of words (letters taken as equally wide), a little bigger all round. */
export function lettersBox(bit: TextBox, from: number, to: number, page: number, pad = 1): Mark {
  const n = Math.max(1, bit.str.length);
  const x = bit.x + (bit.width * from) / n;
  const width = (bit.width * (to - from)) / n;
  return { page, x: x - pad, y: bit.y - pad, width: width + pad * 2, height: bit.height + pad * 2 };
}

/**
 * The parts of a page's words that no mark touches, letter by letter (letters
 * taken as equally wide across each bit), joined into runs. Words under a
 * mark are left out completely: they're gone from the page.
 */
export function wordsOutside(bits: readonly TextBox[], marks: readonly Box[]): KeptWords[] {
  const kept: KeptWords[] = [];
  for (const bit of bits) {
    if (!bit.str.trim()) continue;
    const hit = marks.filter((m) => overlaps(bit, m));
    if (!hit.length) {
      kept.push({ text: bit.str, x: bit.x, y: bit.y, width: bit.width, height: bit.height });
      continue;
    }
    const n = bit.str.length;
    const w = bit.width / n;
    let run = "";
    let start = 0;
    const flush = (end: number) => {
      if (run.trim()) kept.push({ text: run, x: bit.x + start * w, y: bit.y, width: (end - start) * w, height: bit.height });
      run = "";
    };
    for (let i = 0; i < n; i++) {
      const letter = { x: bit.x + i * w, y: bit.y, width: w, height: bit.height };
      if (hit.some((m) => overlaps(letter, m))) {
        flush(i);
        start = i + 1;
      } else {
        if (!run) start = i;
        run += bit.str[i];
      }
    }
    flush(n);
  }
  return kept;
}

/** Marks grouped by page (pages in order). */
export function marksByPage(marks: readonly Mark[]): Map<number, Mark[]> {
  const by = new Map<number, Mark[]>();
  for (const m of [...marks].sort((a, b) => a.page - b.page)) {
    const list = by.get(m.page) ?? [];
    list.push(m);
    by.set(m.page, list);
  }
  return by;
}

/** "3 places on 2 pages". */
export function marksLabel(marks: readonly Mark[]): string {
  const pages = new Set(marks.map((m) => m.page)).size;
  const places = `${marks.length} ${marks.length === 1 ? "place" : "places"}`;
  return pages > 1 ? `${places} on ${pages} pages` : `${places} on page ${(marks[0]?.page ?? 0) + 1}`;
}
