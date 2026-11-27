/**
 * Sticky notes (pure): comments pinned to a place on a page, as other PDF
 * readers make them (a PDF "Text" note: an icon on the page that opens to show
 * its words, who wrote it and when, and any replies).
 */

export type Rgb = [number, number, number];

export interface NoteReply {
  id: string;
  author: string;
  text: string;
  /** When it was last changed, as the PDF says it ("D:20261127140500Z"), or "". */
  when: string;
}

export interface Note {
  /** Which note in the PDF (the PDF's own number for it, e.g. "12R"). */
  id: string;
  /** Page, from 0. */
  page: number;
  /** Its icon: points from the page's top-left, as shown. */
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  author: string;
  colour: Rgb;
  when: string;
  replies: NoteReply[];
}

/** A note open to read or change: a new one (no id) isn't in the PDF until it's saved. */
export interface OpenNote {
  id?: string;
  page: number;
  x: number;
  y: number;
  text: string;
  author: string;
  colour: Rgb;
  when: string;
  replies: NoteReply[];
}

/** How big a note's icon is, in points (as pdf.js and Acrobat draw them). */
export const NOTE_SIZE = 22;

export const NOTE_COLOURS: { name: string; rgb: Rgb }[] = [
  { name: "Yellow", rgb: [1, 0.82, 0.2] },
  { name: "Blue", rgb: [0.45, 0.7, 1] },
  { name: "Green", rgb: [0.45, 0.85, 0.45] },
  { name: "Pink", rgb: [1, 0.55, 0.75] },
];

export const DEFAULT_NOTE_COLOUR: Rgb = NOTE_COLOURS[0].rgb;

/** The colour as CSS, e.g. "#ffd133". */
export function colourCss(rgb: readonly number[]): string {
  const c = rgb.length === 3 ? rgb : DEFAULT_NOTE_COLOUR;
  return `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** A colour from a PDF's /C array (0–1 each): grey for one number, CMYK for four; null when there's none. */
export function colourFrom(values: readonly number[]): Rgb | null {
  const v = values.map((n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0)));
  if (v.length === 1) return [v[0], v[0], v[0]];
  if (v.length === 3) return [v[0], v[1], v[2]];
  if (v.length === 4) return [(1 - v[0]) * (1 - v[3]), (1 - v[1]) * (1 - v[3]), (1 - v[2]) * (1 - v[3])];
  return null;
}

const two = (n: number) => String(n).padStart(2, "0");

/** A date as PDFs write them, in UTC: "D:20261127140500Z". */
export function pdfDate(d: Date): string {
  return `D:${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`;
}

/** A PDF's date ("D:YYYYMMDDHHmmSS+01'00'", any part after the year may be missing), or null if it isn't one. */
export function readPdfDate(s: string): Date | null {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz+-])(\d{2})?'?(\d{2})?'?)?/.exec(s.trim());
  if (!m) return null;
  const [y, mo = "01", d = "01", h = "00", mi = "00", se = "00"] = m.slice(1, 7);
  let t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
  if (m[7] === "+" || m[7] === "-") {
    const off = (Number(m[8] ?? 0) * 60 + Number(m[9] ?? 0)) * 60_000;
    t += m[7] === "+" ? -off : off;
  }
  return Number.isNaN(t) ? null : new Date(t);
}

/** When a note was written, in words for this computer: "27 Nov 2026, 14:05", or "" if unknown. */
export function whenLabel(when: string, locale?: string): string {
  const d = readPdfDate(when);
  if (!d) return "";
  return d.toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Where a new note's icon goes for a click at (x, y): just there, kept inside the page. */
export function notePlace(x: number, y: number, pageWidth: number, pageHeight: number, size = NOTE_SIZE): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(pageWidth - size, x - size / 2)),
    y: Math.max(0, Math.min(pageHeight - size, y - size / 2)),
  };
}

/** The first line of a note, cut short, for lists. */
export function noteSummary(text: string, most = 80): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > most ? `${line.slice(0, most - 1).trimEnd()}…` : line;
}

/** "1 note" / "3 notes". */
export const notesCount = (n: number) => `${n} note${n === 1 ? "" : "s"}`;

/** Notes in reading order: by page, then top to bottom, then left to right. */
export function inReadingOrder(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => a.page - b.page || Math.round(a.y - b.y) || a.x - b.x);
}

/**
 * Join replies onto the notes they answer ("In reply to"); a reply to a reply
 * goes on the note at the top. Replies whose note can't be found show as notes.
 */
export function withReplies(notes: readonly (Note & { inReplyTo?: string })[]): Note[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  /** The note at the top of a reply's chain (itself when it's not a reply, or the chain goes round in a circle). */
  const top = (n: Note & { inReplyTo?: string }) => {
    const seen = new Set([n.id]);
    let at = n;
    for (;;) {
      const parent = at.inReplyTo ? byId.get(at.inReplyTo) : undefined;
      if (!parent) return at;
      if (seen.has(parent.id)) return n;
      seen.add(parent.id);
      at = parent;
    }
  };
  const out = new Map<string, Note>();
  const replies: [string, NoteReply][] = [];
  for (const n of notes) {
    const head = top(n);
    const { inReplyTo: _, ...note } = n;
    if (head === n) out.set(n.id, { ...note, replies: [] });
    else replies.push([head.id, { id: n.id, author: n.author, text: n.text, when: n.when }]);
  }
  for (const [id, r] of replies) out.get(id)?.replies.push(r);
  for (const n of out.values()) n.replies.sort((a, b) => (readPdfDate(a.when)?.getTime() ?? 0) - (readPdfDate(b.when)?.getTime() ?? 0));
  return [...out.values()];
}
