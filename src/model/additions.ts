/**
 * Words and pictures added onto a page. Pure: where things go. Positions are
 * in points "as shown" (after the page's own turn), measured from the page's
 * top-left corner, like on screen; src/pdf/additions.ts turns them into the
 * page's own space and writes them.
 */
import type { FontChoice } from "./watermark";

/** Words typed onto a page (one or more lines, left-aligned). */
export interface WordsItem {
  kind: "words";
  /** The page (0 = first). */
  page: number;
  /** The top-left corner of the first line, in points from the page's top-left as shown. */
  x: number;
  y: number;
  text: string;
  font: FontChoice;
  /** Letter size in points. */
  size: number;
  /** "#rrggbb". */
  colour: string;
}

/** A picture (PNG or JPG) put onto a page. */
export interface PictureItem {
  kind: "picture";
  page: number;
  /** Its top-left corner and size, in points as shown. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AddItem = WordsItem | PictureItem;

/** Lines are this many times the letter size apart. */
export const LINE_HEIGHT = 1.2;

/**
 * How far down a line (in letter sizes) its words sit, matching how the
 * browser lays out a line LINE_HEIGHT tall in the closest screen font, so the
 * words land where they were typed.
 */
export const BASELINE: Record<FontChoice, number> = {
  Helvetica: 0.947,
  HelveticaBold: 0.947,
  TimesRoman: 0.933,
  TimesRomanBold: 0.933,
  Courier: 0.866,
  CourierBold: 0.866,
};

/** The closest screen font to each PDF font, for typing in. */
export const SCREEN_FONT: Record<FontChoice, { family: string; weight: number }> = {
  Helvetica: { family: 'Helvetica, Arial, "Liberation Sans", sans-serif', weight: 400 },
  HelveticaBold: { family: 'Helvetica, Arial, "Liberation Sans", sans-serif', weight: 700 },
  TimesRoman: { family: '"Times New Roman", Times, "Liberation Serif", serif', weight: 400 },
  TimesRomanBold: { family: '"Times New Roman", Times, "Liberation Serif", serif', weight: 700 },
  Courier: { family: '"Courier New", Courier, "Liberation Mono", monospace', weight: 400 },
  CourierBold: { family: '"Courier New", Courier, "Liberation Mono", monospace', weight: 700 },
};

export const DEFAULT_WORDS = { font: "Helvetica" as FontChoice, size: 14, colour: "#1f2a37" };
export const MIN_WORD_SIZE = 4;
export const MAX_WORD_SIZE = 300;

/** The lines of typed words (tabs become spaces; trailing spaces go). Empty lines stay, as gaps. */
export function linesOf(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return lines;
}

/** A letter size kept within sensible bounds. */
export function cleanSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_WORDS.size;
  return Math.round(Math.min(MAX_WORD_SIZE, Math.max(MIN_WORD_SIZE, size)) * 10) / 10;
}

/** Where each line's words start: its left end on the line the letters sit on, as shown (points from the top-left). */
export function lineStarts(item: WordsItem): { text: string; x: number; y: number }[] {
  return linesOf(item.text)
    .map((text, i) => ({ text, x: item.x, y: item.y + (i * LINE_HEIGHT + BASELINE[item.font]) * item.size }))
    .filter((l) => l.text.length > 0);
}

/** How tall a block of words is, in points. */
export function wordsHeight(item: Pick<WordsItem, "text" | "size">): number {
  return Math.max(1, linesOf(item.text).length) * LINE_HEIGHT * item.size;
}

/**
 * A picture's starting size: as big as it is (at 96 dots to the inch), but at
 * least an inch on its longer side (so a tiny one can be seen and grabbed)
 * and no more than half the page wide or tall.
 */
export function startingPictureSize(pixelsWide: number, pixelsHigh: number, pageW: number, pageH: number): { width: number; height: number } {
  const w = Math.max(1, pixelsWide) * 0.75;
  const h = Math.max(1, pixelsHigh) * 0.75;
  const grow = Math.max(1, 72 / Math.max(w, h));
  const scale = Math.min(grow, (pageW * 0.5) / w, (pageH * 0.5) / h);
  return { width: w * scale, height: h * scale };
}

/** Keep a box of this size on the page: at least `keep` points of it stay inside each edge. */
export function keepOnPage(x: number, y: number, w: number, h: number, pageW: number, pageH: number, keep = 12): { x: number; y: number } {
  const k = Math.min(keep, w, h);
  return {
    x: Math.min(pageW - k, Math.max(k - w, x)),
    y: Math.min(pageH - k, Math.max(k - h, y)),
  };
}

/** What a change is called in the Undo list. */
export function additionLabel(item: AddItem): string {
  if (item.kind === "picture") return `add a picture to page ${item.page + 1}`;
  const first = linesOf(item.text)[0] ?? "";
  return `add “${first.length > 30 ? `${first.slice(0, 29)}…` : first}” to page ${item.page + 1}`;
}

/** A picture chosen to put on a page. */
export interface ChosenPicture {
  bytes: Uint8Array;
  type: "png" | "jpg";
  name: string;
  /** For showing it while it's placed (an object URL). */
  url: string;
  pixelsWide: number;
  pixelsHigh: number;
}

/** Waiting for a click on a page to put words or a chosen picture there. */
export type Placing = { kind: "words" } | { kind: "picture"; picture: ChosenPicture };

/** Words or a picture on a page, being typed, moved or sized, not yet written into the PDF. */
export type Draft = WordsItem | (PictureItem & { picture: ChosenPicture });
