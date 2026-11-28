/**
 * Comparing two PDFs by their words, pure: each file's words in reading order
 * (where each sits, in pdf.js's bits of words), the fewest words taken out and
 * put in to turn the other file into this one (Myers' way of comparing), and
 * those gathered into changes ("words put in", "taken out", "changed").
 */
import { foldLetter } from "./search";

/** Where part of a word sits: letters `from` to `to` of bit `bit` of a page's words. */
export interface WordPiece {
  bit: number;
  from: number;
  to: number;
}

/** A word in a file: its text, how it's compared (curly quotes, dashes, ligatures made plain), its page (from 0) and where it sits. */
export interface WordAt {
  text: string;
  key: string;
  page: number;
  pieces: WordPiece[];
}

export type ChangeKind = "added" | "removed" | "changed";

/** One difference: words only in this file, only in the other, or both (words changed). */
export interface Change {
  kind: ChangeKind;
  /** The other file's words here (none for words put in). */
  was: string;
  /** This file's words here (none for words taken out). */
  now: string;
  /** The page in this file (from 0) and in the other file. */
  page: number;
  otherPage: number;
  /** This file's words that are new or changed (for colouring them in). */
  words: WordAt[];
  /** For words taken out: the word in this file just before the gap (or just after, at the very start), to show where. */
  near: WordAt | null;
  /** True when `near` is the word after the gap. */
  nearIsAfter: boolean;
}

/** Too many differences to work out quickly: the files are too unlike to compare word by word. */
export const MOST_DIFFERENCES = 2500;

/** The words on a page, from pdf.js's bits of words in order (line ends count as a space). A word may run across bits. */
export function wordsIn(bits: readonly { str: string; hasEOL?: boolean }[], page: number): WordAt[] {
  const out: WordAt[] = [];
  let text = "";
  let key = "";
  let pieces: WordPiece[] = [];
  const end = () => {
    if (key) out.push({ text, key, page, pieces });
    text = "";
    key = "";
    pieces = [];
  };
  bits.forEach((bit, b) => {
    const letters = [...bit.str];
    let at = 0;
    for (const c of letters) {
      const f = foldLetter(c, true);
      const i = at;
      at += c.length;
      if (f === " ") {
        end();
        continue;
      }
      if (!f) continue;
      text += c;
      key += f;
      const last = pieces[pieces.length - 1];
      if (last && last.bit === b && last.to === i) last.to = at;
      else pieces.push({ bit: b, from: i, to: at });
    }
    if (bit.hasEOL) end();
  });
  end();
  return out;
}

/** One step from the other file's words to this file's: keep one, take one out (of the other) or put one in (from this). */
export type Step = { op: "same"; a: number; b: number } | { op: "out"; a: number } | { op: "in"; b: number };

/**
 * The fewest steps turning `a` into `b` (Myers' way, with the start and end
 * they share taken off first). Null when there are more than `most` words
 * different.
 */
export function compareLists(a: readonly string[], b: readonly string[], most = MOST_DIFFERENCES): Step[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = middleSteps(a, b, start, endA, start, endB, most);
  if (!middle) return null;
  const steps: Step[] = [];
  for (let i = 0; i < start; i++) steps.push({ op: "same", a: i, b: i });
  steps.push(...middle);
  for (let i = 0; endA + i < a.length; i++) steps.push({ op: "same", a: endA + i, b: endB + i });
  return steps;
}

function middleSteps(a: readonly string[], b: readonly string[], a0: number, a1: number, b0: number, b1: number, most: number): Step[] | null {
  const n = a1 - a0;
  const m = b1 - b0;
  if (!n && !m) return [];
  if (!n) return Array.from({ length: m }, (_, i) => ({ op: "in", b: b0 + i }) as Step);
  if (!m) return Array.from({ length: n }, (_, i) => ({ op: "out", a: a0 + i }) as Step);
  const max = Math.min(n + m, most);
  // v[k] = how far along `a` the furthest path on diagonal k (x − y) reaches; one copy kept for each number of differences, to walk back.
  const trace: Int32Array[] = [];
  let v = new Int32Array(3);
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    const next = new Int32Array(2 * d + 3);
    // Diagonal k sits at next[k + d + 1]; the last round's diagonal k at v[k + d].
    const old = (k: number) => (k >= -(d - 1) && k <= d - 1 ? v[k + d] : -1);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (d === 0) x = 0;
      else if (k === -d || (k !== d && old(k - 1) < old(k + 1))) x = old(k + 1);
      else x = old(k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      next[k + d + 1] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    trace.push(next);
    v = next;
  }
  if (found < 0) return null;
  // Walk back from the end.
  const steps: Step[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1];
    const at = (k: number) => (k >= -(d - 1) && k <= d - 1 ? prev[k + d] : -1);
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = at(pk);
    const py = px - pk;
    while (x > px + (down ? 0 : 1) && y > py + (down ? 1 : 0)) {
      x--;
      y--;
      steps.push({ op: "same", a: a0 + x, b: b0 + y });
    }
    if (down) {
      y--;
      steps.push({ op: "in", b: b0 + y });
    } else {
      x--;
      steps.push({ op: "out", a: a0 + x });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    steps.push({ op: "same", a: a0 + x, b: b0 + y });
  }
  return steps.reverse();
}

/**
 * The changes from the other file's words to this file's, in reading order;
 * null when the files are too unlike to compare word by word.
 */
export function changesBetween(other: readonly WordAt[], mine: readonly WordAt[], most = MOST_DIFFERENCES): Change[] | null {
  const steps = compareLists(
    other.map((w) => w.key),
    mine.map((w) => w.key),
    most,
  );
  if (!steps) return null;
  const changes: Change[] = [];
  let outs: WordAt[] = [];
  let ins: WordAt[] = [];
  // How far along each file the steps have got.
  let nextA = 0;
  let nextB = 0;
  const flush = () => {
    if (!outs.length && !ins.length) return;
    const kind: ChangeKind = !outs.length ? "added" : !ins.length ? "removed" : "changed";
    const before = nextB > 0 ? mine[nextB - 1 - ins.length] ?? null : null;
    const after = mine[nextB] ?? null;
    const near = kind === "removed" ? before ?? after : null;
    const otherPage = outs[0]?.page ?? other[nextA]?.page ?? other[nextA - 1]?.page ?? 0;
    const page = ins[0]?.page ?? near?.page ?? 0;
    changes.push({ kind, was: joined(outs), now: joined(ins), page, otherPage, words: ins, near, nearIsAfter: kind === "removed" && !before && !!after });
    outs = [];
    ins = [];
  };
  for (const s of steps) {
    if (s.op === "same") {
      flush();
      nextA = s.a + 1;
      nextB = s.b + 1;
    } else if (s.op === "out") {
      outs.push(other[s.a]);
      nextA = s.a + 1;
    } else {
      ins.push(mine[s.b]);
      nextB = s.b + 1;
    }
  }
  flush();
  return changes;
}

const joined = (words: readonly WordAt[]) => words.map((w) => w.text).join(" ");

/** Words cut short for a list: "the quick brown…". */
export function clip(words: string, most = 70): string {
  return words.length > most ? `${words.slice(0, most - 1).trimEnd()}…` : words;
}

/** How a change reads in the list, e.g. “quick” → “slow”. */
export function changeLine(c: Pick<Change, "kind" | "was" | "now">, most = 70): string {
  if (c.kind === "added") return `Put in: “${clip(c.now, most)}”`;
  if (c.kind === "removed") return `Taken out: “${clip(c.was, most)}”`;
  return `“${clip(c.was, most)}” → “${clip(c.now, most)}”`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A line saying what was found, e.g. "3 changes: 2 words put in, 1 taken out, 1 changed." */
export function compareSummary(changes: readonly Change[] | null, otherName: string): string {
  if (!changes) return `This PDF and ${otherName} are too different to compare word by word.`;
  if (!changes.length) return `The words in this PDF and ${otherName} are the same.`;
  const count = (k: ChangeKind) => changes.filter((c) => c.kind === k).length;
  const parts = [
    count("added") && `${count("added")} put in`,
    count("removed") && `${count("removed")} taken out`,
    count("changed") && `${count("changed")} changed`,
  ].filter(Boolean);
  return `${plural(changes.length, "difference")} from ${otherName}: ${parts.join(", ")}.`;
}

/** What a sticky note says for a change marked on the page (none for words just put in: they're coloured in). */
export function noteFor(c: Pick<Change, "kind" | "was" | "now">, otherName: string): string | null {
  if (c.kind === "added") return null;
  if (c.kind === "removed") return `Taken out (was in ${otherName}): “${clip(c.was, 600)}”`;
  return `Changed. In ${otherName} this was: “${clip(c.was, 600)}”`;
}

/** A plain-text list of the changes, for Claude or to save: one line each with its page (from 1). */
export function changesText(changes: readonly Change[] | null, otherName: string, most = 300): string {
  const lines = [compareSummary(changes, otherName)];
  if (!changes) return lines[0];
  for (const c of changes.slice(0, most)) lines.push(`- Page ${c.page + 1} (page ${c.otherPage + 1} in ${otherName}): ${changeLine(c, 200)}`);
  if (changes.length > most) lines.push(`(and ${changes.length - most} more)`);
  return lines.join("\n");
}

/**
 * A box in points from a page's top-left, as shown. Words that aren't level
 * have `turn` (degrees, clockwise as shown): the box is then drawn turned
 * about its bottom-left corner, (x, y + height).
 */
export interface PlaceBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  turn?: number;
}

/** Comparing the open PDF with another one (kept in the store). */
export interface CompareState {
  /** The other file's name. */
  otherName: string;
  /** Its words, and how many pages it has. */
  other: WordAt[];
  otherPages: number;
  /** The differences, once worked out for the version `forDoc` (null: too different). */
  changes: Change[] | null;
  /** Where each change shows on this file: its new words' boxes, or a thin bar where words were taken out. */
  places: PlaceBox[][];
  /** Which version of this file they're for (a pdf.js document), or null while reading. */
  forDoc: unknown;
  /** "Reading page 4 of 20…" while busy. */
  progress: string | null;
  /** The change being shown (-1 for none), and whether the page view should scroll to it (once it's drawn). */
  current: number;
  scrollTo: boolean;
}
