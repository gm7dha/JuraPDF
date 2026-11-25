/**
 * Words and pictures added onto a page. Pure: where things go. Positions are
 * in points "as shown" (after the page's own turn), measured from the page's
 * top-left corner, like on screen; src/pdf/additions.ts turns them into the
 * page's own space and writes them.
 */
import { toPageSpace, type FontChoice, type PageFrame } from "./watermark";

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

export type ShapeKind = "highlight" | "box" | "oval" | "line" | "arrow";

/** A highlight, box, oval, line or arrow drawn on a page, from one point to another (points as shown, from the top-left). */
export interface ShapeItem {
  kind: "shape";
  shape: ShapeKind;
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** "#rrggbb". */
  colour: string;
  /** How thick its lines are, in points (not used by a highlight, which is filled). */
  thickness: number;
}

export type AddItem = WordsItem | PictureItem | ShapeItem;

export const SHAPE_NAMES: Record<ShapeKind, string> = {
  highlight: "Highlight",
  box: "Box",
  oval: "Oval",
  line: "Line",
  arrow: "Arrow",
};

/** How each shape starts out: a see-through yellow highlight; red boxes, ovals, lines and arrows. */
export const SHAPE_STYLE: Record<ShapeKind, { colour: string; thickness: number }> = {
  highlight: { colour: "#ffd400", thickness: 0 },
  box: { colour: "#d1373a", thickness: 2 },
  oval: { colour: "#d1373a", thickness: 2 },
  line: { colour: "#d1373a", thickness: 2 },
  arrow: { colour: "#d1373a", thickness: 2 },
};

/** How see-through a highlight is (the words under it still show). */
export const HIGHLIGHT_OPACITY = 0.45;

/** The box a shape fills (left, top, width, height), whichever way it was drawn. */
export function shapeBox(s: Pick<ShapeItem, "x1" | "y1" | "x2" | "y2">): { x: number; y: number; width: number; height: number } {
  return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), width: Math.abs(s.x2 - s.x1), height: Math.abs(s.y2 - s.y1) };
}

/** A shape drawn with hardly any drag (a click) gets a sensible size instead. */
export function sizedShape(s: ShapeItem): ShapeItem {
  const { width, height } = shapeBox(s);
  if (Math.max(width, height) >= 6) return s;
  if (s.shape === "line" || s.shape === "arrow") return { ...s, x2: s.x1 + 100, y2: s.y1 };
  if (s.shape === "highlight") return { ...s, x2: s.x1 + 120, y2: s.y1 + 14 };
  return { ...s, x2: s.x1 + 100, y2: s.y1 + 60 };
}

/** An arrow's head: the three corners of its triangle, at (x2, y2), sized to the line's thickness. */
export function arrowHead(s: Pick<ShapeItem, "x1" | "y1" | "x2" | "y2" | "thickness">): [number, number][] {
  const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1;
  const ux = (s.x2 - s.x1) / len;
  const uy = (s.y2 - s.y1) / len;
  const size = Math.min(len * 0.6, 6 + s.thickness * 3);
  const bx = s.x2 - ux * size;
  const by = s.y2 - uy * size;
  const half = size * 0.45;
  return [
    [s.x2, s.y2],
    [bx - uy * half, by + ux * half],
    [bx + uy * half, by - ux * half],
  ];
}

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
  if (item.kind === "shape") return `add ${item.shape === "arrow" || item.shape === "oval" ? "an" : "a"} ${SHAPE_NAMES[item.shape].toLowerCase()} to page ${item.page + 1}`;
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
export type Placing = { kind: "words" } | { kind: "picture"; picture: ChosenPicture } | { kind: "shape"; shape: ShapeKind };

/** Words or a picture on a page, being typed, moved or sized, not yet written into the PDF. */
export type Draft = WordsItem | (PictureItem & { picture: ChosenPicture }) | ShapeItem;

type Pt = { x: number; y: number };

/**
 * Where a shape goes in the page's own space (y up, before the page's turn):
 * the box it fills, its two ends (the line stopping inside an arrow's head) and
 * an arrow's head.
 */
export function shapeInPage(frame: PageFrame, item: ShapeItem): { box: { x: number; y: number; width: number; height: number }; start: Pt; end: Pt; head: Pt[] | null } {
  const shownH = frame.rotation % 180 ? frame.width : frame.height;
  const at = (x: number, y: number): Pt => {
    const p = toPageSpace(frame, x, shownH - y, 0);
    return { x: p.x, y: p.y };
  };
  const a = at(item.x1, item.y1);
  const z = at(item.x2, item.y2);
  // Turning a page by quarter turns keeps boxes square to it, so a box is still its two corners.
  const box = { x: Math.min(a.x, z.x), y: Math.min(a.y, z.y), width: Math.abs(z.x - a.x), height: Math.abs(z.y - a.y) };
  if (item.shape !== "arrow") return { box, start: a, end: z, head: null };
  const head = arrowHead(item);
  return { box, start: a, end: at((head[1][0] + head[2][0]) / 2, (head[1][1] + head[2][1]) / 2), head: head.map(([x, y]) => at(x, y)) };
}

/** A box in points on a page, from its top-left as it shows. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Highlights over picked words: the boxes of the picked words on one page
 * (in points), joined up line by line so each line gets one highlight, a
 * touch taller than the letters.
 */
export function highlightsFor(page: number, rects: Rect[], colour: string): ShapeItem[] {
  const usable = rects.filter((r) => r.width > 0.5 && r.height > 0.5);
  if (!usable.length) return [];
  // Leave out anything far taller than the words around it (a whole block picked by mistake).
  const heights = usable.map((r) => r.height).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)];
  const sorted = usable.filter((r) => r.height <= typical * 3).sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x);
  const lines: Rect[] = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    const overlap = last ? Math.min(last.y + last.height, r.y + r.height) - Math.max(last.y, r.y) : 0;
    const sameLine = last && overlap > Math.min(last.height, r.height) * 0.5 && r.x <= last.x + last.width + Math.max(last.height, r.height);
    if (last && sameLine) {
      const x = Math.min(last.x, r.x);
      const y = Math.min(last.y, r.y);
      lines[lines.length - 1] = { x, y, width: Math.max(last.x + last.width, r.x + r.width) - x, height: Math.max(last.y + last.height, r.y + r.height) - y };
    } else lines.push({ ...r });
  }
  return lines.map((l) => {
    const pad = l.height * 0.1;
    return { kind: "shape", shape: "highlight", page, x1: l.x - pad / 2, y1: l.y - pad, x2: l.x + l.width + pad / 2, y2: l.y + l.height + pad, colour, thickness: 0 };
  });
}
