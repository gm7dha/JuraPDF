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

/**
 * Where a run of words that isn't level sits (sideways or upside down as
 * shown, e.g. on a turned page): where its baseline starts, its turn
 * (degrees, clockwise as shown), how long it is and how big its letters are.
 */
export interface Along {
  x: number;
  y: number;
  turn: number;
  length: number;
  size: number;
}

/** A bit of a page's words with its box as shown (from pdf.js); `along` when it isn't level. */
export interface TextBox {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  along?: Along;
}

/** A word to write back invisibly (so the page's other words can still be picked and found); `along` when it isn't level. */
export interface KeptWords {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  along?: Along;
}

/**
 * The upright box around part of a run that isn't level: from `from` to `to`
 * points along its baseline, and from a little below the baseline (for the
 * tails of letters) to the top of its letters.
 */
export function runBox(a: Along, from: number, to: number): { x: number; y: number; width: number; height: number } {
  const r = (a.turn * Math.PI) / 180;
  const u = [Math.cos(r), Math.sin(r)];
  // "Up" from the baseline, as shown (y goes down the page).
  const up = [u[1], -u[0]];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of [from, to])
    for (const h of [-0.2 * a.size, a.size]) {
      xs.push(a.x + u[0] * t + up[0] * h);
      ys.push(a.y + u[1] * t + up[1] * h);
    }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Is (x, y) on the letters of a run that isn't level (not just inside the upright box round it)? */
export function onRun(a: Along, x: number, y: number): boolean {
  const r = (a.turn * Math.PI) / 180;
  const [ux, uy] = [Math.cos(r), Math.sin(r)];
  const [dx, dy] = [x - a.x, y - a.y];
  const t = dx * ux + dy * uy;
  const h = dx * uy - dy * ux;
  return t >= 0 && t <= a.length && h >= -0.2 * a.size && h <= a.size;
}

/** Does a run read sideways or upside down (turned a quarter, a half or three quarters, not slanting)? */
export const quarterTurned = (a: Along) => Math.abs(((((a.turn % 90) + 90) % 90) + 45) % 90 - 45) < 5;

/** A bit's words from pdf.js's matrix for it (already as shown, y down): its box, and `along` when it isn't level. */
export function textBoxFrom(str: string, m: readonly number[], width: number, fallbackHeight: number): (TextBox & { usable: boolean }) | null {
  const [a, b, c, d, e, f] = m;
  const size = Math.hypot(a, b) || fallbackHeight;
  // Mirrored words (seen from behind) can't be written back: they're left out.
  const usable = a * d - b * c < 0;
  const turn = (Math.atan2(b, a) * 180) / Math.PI;
  if (Math.abs(turn) < 3) return { str, x: e, y: f - size, width, height: size * 1.2, usable };
  const along: Along = { x: e, y: f, turn, length: width, size };
  return { str, ...runBox(along, 0, width), along, usable };
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
  if (bit.along) {
    const each = bit.along.length / n;
    const b = runBox(bit.along, each * from, each * to);
    return { page, x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
  }
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
      kept.push({ text: bit.str, x: bit.x, y: bit.y, width: bit.width, height: bit.height, ...(bit.along ? { along: bit.along } : {}) });
      continue;
    }
    const n = bit.str.length;
    const a = bit.along;
    const w = (a ? a.length : bit.width) / n;
    let run = "";
    let start = 0;
    const flush = (end: number) => {
      if (run.trim()) {
        if (a) {
          const r = (a.turn * Math.PI) / 180;
          const along = { ...a, x: a.x + Math.cos(r) * start * w, y: a.y + Math.sin(r) * start * w, length: (end - start) * w };
          kept.push({ text: run, ...runBox(along, 0, along.length), along });
        } else kept.push({ text: run, x: bit.x + start * w, y: bit.y, width: (end - start) * w, height: bit.height });
      }
      run = "";
    };
    for (let i = 0; i < n; i++) {
      const letter = a ? runBox(a, i * w, (i + 1) * w) : { x: bit.x + i * w, y: bit.y, width: w, height: bit.height };
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
