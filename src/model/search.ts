/**
 * Finding words in the PDF (the search bar).
 *
 * Each page's words come from pdf.js as "bits" (runs of letters, in reading
 * order, each marked where its line ends), the same bits the page's words
 * layer is built from, one span each. A page's bits are joined into one line of
 * text, folded so small differences don't matter (capitals unless asked,
 * accents, curly quotes, dashes, runs of spaces, line ends), and every folded
 * letter remembers which bit and which letters of it it came from, so a match
 * can be highlighted on the page exactly.
 */
import type { TextBit } from "./textOut";

/** A page's words, folded for finding. */
export interface PageWords {
  /** The folded text. */
  text: string;
  /** For each folded letter: which bit it came from, and which letters of that bit (from, to). */
  bit: number[];
  from: number[];
  to: number[];
  /** True when the page has any words at all (a scan without read words has none). */
  hasWords: boolean;
}

/** Letters of one bit (one span on the page) that a match covers. */
export interface HitPiece {
  bit: number;
  from: number;
  to: number;
}

/** One place the words were found. */
export interface SearchHit {
  /** The page (0 = first). */
  page: number;
  pieces: HitPiece[];
}

/** What the search bar is doing (null in the store when it's closed). */
export interface SearchState {
  query: string;
  /** Only find words with the same capitals. Off unless asked. */
  matchCase: boolean;
  /** Every place found so far, in page order. */
  hits: SearchHit[];
  /** The one shown (an index into hits), or -1. */
  current: number;
  /** How many pages have been looked through so far, of `total`. */
  read: number;
  total: number;
  /** Pages with no words at all (0 = first): scans, photos or blank pages. */
  noWords: number[];
  /** A hit to scroll into view once its page is drawn, or null. */
  scrollTo: number | null;
  /** Changes for each new look through (so an old one can't land late). */
  run: number;
}

const QUOTES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "`": "'",
  "´": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "″": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
};

/** Letters that are there but don't show (soft hyphens, zero-width spaces). */
const INVISIBLE = /[­​-‍⁠﻿]/;
const MARKS = /\p{M}/gu;
const SPACE = /\s/;

/** One letter, folded: "" to leave it out, " " for any kind of space. */
export function foldLetter(c: string, matchCase: boolean): string {
  if (INVISIBLE.test(c)) return "";
  if (SPACE.test(c)) return " ";
  // NFKD splits ligatures (ﬁ → fi) and full-width letters, and takes accents off as separate marks.
  // Without "match capitals", accents don't count either (cafe finds café).
  let f = c.normalize("NFKD");
  if (!matchCase) f = f.toLowerCase().normalize("NFKD").replace(MARKS, "");
  f = [...f].map((x) => QUOTES[x] ?? x).join("");
  return SPACE.test(f) ? " " : f;
}

/** What to look for, folded the same way as the pages; "" when there's nothing to find. */
export function foldQuery(query: string, matchCase: boolean): string {
  let out = "";
  for (const c of query) {
    const f = foldLetter(c, matchCase);
    if (f === " " && (out === "" || out.endsWith(" "))) continue;
    out += f;
  }
  return out.trimEnd();
}

/** Join and fold a page's bits. Line ends count as a space. */
export function pageWords(bits: TextBit[], matchCase: boolean): PageWords {
  const out: string[] = [];
  const bit: number[] = [];
  const from: number[] = [];
  const to: number[] = [];
  let hasWords = false;
  // Starts as if after a space, so spaces at the very start are left out.
  let afterSpace = true;
  const push = (f: string, b: number, a: number, z: number) => {
    for (const x of f) {
      if (x === " ") {
        if (afterSpace) continue;
        afterSpace = true;
      } else {
        afterSpace = false;
        hasWords = true;
      }
      out.push(x);
      bit.push(b);
      from.push(a);
      to.push(z);
    }
  };
  for (let i = 0; i < bits.length; i++) {
    const str = bits[i].str;
    for (let at = 0; at < str.length; ) {
      const code = str.charCodeAt(at);
      // Plain letters (most words) quickly; anything else the careful way.
      if (code < 0x80 && code !== 0x60) {
        const space = code === 32 || (code >= 9 && code <= 13);
        push(space ? " " : !matchCase && code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : str[at], i, at, at + 1);
        at++;
      } else {
        const c = String.fromCodePoint(str.codePointAt(at) ?? code);
        push(foldLetter(c, matchCase), i, at, at + c.length);
        at += c.length;
      }
    }
    if (bits[i].hasEOL) push(" ", i, str.length, str.length);
  }
  return { text: out.join(""), bit, from, to, hasWords };
}

/** Every place the (already folded) query is on a page, one after another, not overlapping. */
export function findOnPage(words: PageWords, folded: string, page: number): SearchHit[] {
  const hits: SearchHit[] = [];
  if (!folded) return hits;
  let at = words.text.indexOf(folded);
  while (at >= 0) {
    hits.push({ page, pieces: piecesOf(words, at, at + folded.length) });
    at = words.text.indexOf(folded, at + folded.length);
  }
  return hits;
}

/** The letters of each bit that folded letters start…end came from. */
function piecesOf(words: PageWords, start: number, end: number): HitPiece[] {
  const pieces: HitPiece[] = [];
  for (let k = start; k < end; k++) {
    const last = pieces[pieces.length - 1];
    if (last && last.bit === words.bit[k]) {
      last.from = Math.min(last.from, words.from[k]);
      last.to = Math.max(last.to, words.to[k]);
    } else pieces.push({ bit: words.bit[k], from: words.from[k], to: words.to[k] });
  }
  // A line end on its own covers no letters.
  return pieces.filter((p) => p.to > p.from);
}

/** The hits on one page: the first one's index and one past the last (hits are in page order). */
export function hitsOnPage(hits: SearchHit[], page: number): [number, number] {
  const first = firstAtOrAfter(hits, page);
  let end = first;
  while (end < hits.length && hits[end].page === page) end++;
  return [first, end];
}

/** The index of the first hit on `page` or later (hits.length when there's none). */
export function firstAtOrAfter(hits: SearchHit[], page: number): number {
  let lo = 0;
  let hi = hits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hits[mid].page < page) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The next (step 1) or previous (step -1) hit, going round from the last to the first. */
export function stepHit(current: number, count: number, step: 1 | -1, fromPage: number, hits: SearchHit[]): number {
  if (!count) return -1;
  if (current < 0) {
    // Nothing shown yet: the first one from the page being read.
    const i = firstAtOrAfter(hits, fromPage);
    if (step === 1) return i < count ? i : 0;
    return i > 0 ? i - 1 : count - 1;
  }
  return (current + step + count) % count;
}

/** What the search bar says about what's been found, e.g. "3 of 12". */
export function searchCount(s: Pick<SearchState, "query" | "hits" | "current" | "read" | "total">): string {
  if (!s.query.trim()) return "";
  const still = s.read < s.total;
  if (!s.hits.length) return still ? `Looking… page ${s.read + 1} of ${s.total}` : "Not found";
  const of = `${s.hits.length}${still ? "+" : ""}`;
  return s.current >= 0 ? `${s.current + 1} of ${of}` : `${of} found`;
}

/** A kindly word about pages that have no words to look through, or "" when every page has some. */
export function noWordsNote(noWords: number[], total: number, found: boolean): string {
  // When something was found, one page without words is most likely just a blank page: not worth a word.
  if (!noWords.length || (found && noWords.length < 2)) return "";
  if (noWords.length === total)
    return total === 1
      ? "This page has no words to look through: it looks like a scan or a photo. Read the words in its pictures first, then search again."
      : "This PDF has no words to look through: its pages look like scans or photos. Read the words in their pictures first, then search again.";
  const which = noWords.length === 1 ? `Page ${noWords[0] + 1} has` : noWords.length <= 4 ? `Pages ${listPages(noWords)} have` : `${noWords.length} pages have`;
  return `${which} no words to look through (a scan, a photo or a blank page)${found ? "" : ", so the words may be there in a picture"}.`;
}

function listPages(pages: number[]): string {
  const n = pages.map((p) => String(p + 1));
  return n.length === 1 ? n[0] : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}
