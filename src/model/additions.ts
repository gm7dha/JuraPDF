/**
 * Words and pictures added onto a page. Pure: where things go. Positions are
 * in points "as shown" (after the page's own turn), measured from the page's
 * top-left corner, like on screen; src/pdf/additions.ts turns them into the
 * page's own space and writes them.
 */
import { FONT_NAMES, toPageSpace, type FontChoice, type PageFrame } from "./watermark";

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
  /** Changing words already on the page: the old words' box, covered over first (white unless `coverColour`). */
  cover?: Rect;
  /** The colour behind the old words, to cover them with ("#rrggbb"; white if left out). */
  coverColour?: string;
  /** Written in the PDF's own font where it has all the letters (else in `font`, the nearest built-in one). */
  own?: OwnFont;
  /** Which of JuraPDF's own additions on the page this is, when it's being changed. */
  id?: number;
}

/** A font that's already in the PDF, kept when its words are changed. */
export interface OwnFont {
  /** Its name in the PDF, e.g. "ABCDEF+Calibri-Bold". */
  base: string;
  /** The name to show, e.g. "Calibri bold". */
  label: string;
  /** The font pdf.js loaded into the browser for it, to type in (a CSS font name). */
  screen?: string;
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
  /** The picture already in the PDF to draw (its name there), when one of JuraPDF's own pictures is moved. */
  image?: string;
  /** A signature (from the Sign window): named so in Undo. */
  signature?: boolean;
  /** A stamp (from the Stamp window, e.g. "APPROVED"): named so in Undo. */
  stamp?: string;
  id?: number;
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
  /** A box or oval filled in with this colour ("#rrggbb"), or not filled (left out or null). */
  fill?: string | null;
  /** How see-through it is, 0 (solid) to 90, in percent (a highlight is always partly see-through). */
  seeThrough?: number;
  id?: number;
}

/** Drawing freehand, like a pen: one or more strokes, each a run of points (as shown, from the top-left). */
export interface InkItem {
  kind: "ink";
  page: number;
  strokes: [number, number][][];
  colour: string;
  thickness: number;
  seeThrough?: number;
  id?: number;
}

/** The kinds of form box: a box to type in, a tick box, or a list to choose from. */
export type FieldKind = "text" | "tick" | "choice" | "round" | "date";

/** Square kinds (a tick box, a round button): dragged or sized, they stay square. */
export const squareField = (kind: FieldKind) => kind === "tick" || kind === "round";

/**
 * A form box (a "fillable field"): Acrobat, Preview and other PDF readers let
 * whoever opens the PDF type in it, tick it or choose from it.
 */
export interface FieldItem {
  kind: "field";
  field: FieldKind;
  page: number;
  /** Its top-left corner and size, in points as shown. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Its name in the form (each is different; shown to people filling it in by some readers). */
  name: string;
  /** A text box: several lines rather than one. */
  multiline?: boolean;
  /** A text box: the letter size, or 0 to fit the box. */
  size?: number;
  /** A choice list: what can be chosen. */
  choices?: string[];
  /** A round button: what picking it means (its name among the round buttons of its set, which share `name`). */
  option?: string;
  /** A date box: how dates are written, e.g. "dd/mm/yyyy" (see DATE_FORMATS). */
  dateFormat?: string;
  id?: number;
}

export const FIELD_NAMES: Record<FieldKind, string> = { text: "Text box", tick: "Tick box", choice: "Choice list", round: "Round button", date: "Date box" };

/** How a new box of each kind is named ("Text 1"); round buttons are named by their set. */
export const FIELD_BASE: Record<FieldKind, string> = { text: "Text", tick: "Tick", choice: "Choice", round: "Set", date: "Date" };

/** A form box's size when it's put on with a click rather than dragged. */
export const FIELD_SIZE: Record<FieldKind, { width: number; height: number }> = {
  text: { width: 180, height: 22 },
  tick: { width: 14, height: 14 },
  choice: { width: 150, height: 22 },
  round: { width: 14, height: 14 },
  date: { width: 120, height: 22 },
};

/** A form box dragged out from (x1, y1) to (x2, y2); a click (or a tiny drag) gets the usual size. Tick boxes stay square. */
export function fieldBox(kind: FieldKind, x1: number, y1: number, x2: number, y2: number): Rect {
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (Math.max(w, h) < 6) return { x: x1, y: y1, ...FIELD_SIZE[kind] };
  if (squareField(kind)) {
    const side = Math.max(8, Math.min(Math.max(w, h), 72));
    return { x: x2 < x1 ? x1 - side : x1, y: y2 < y1 ? y1 - side : y1, width: side, height: side };
  }
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.max(w, 12), height: Math.max(h, 10) };
}

/** A name for a new form box that no other has ("Text 3"), given the names in use. */
export function freshFieldName(kind: FieldKind, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = FIELD_BASE[kind];
  for (let n = 1; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** A name for a new round button in a set that no other button in it has ("Option 3"), given the ones in use. */
export function freshOption(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) if (!used.has(`Option ${n}`)) return `Option ${n}`;
}

/** Choices typed one to a line (or with commas), tidied: no blanks, no repeats. */
export function choicesOf(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map((c) => c.trim()).filter(Boolean))];
}

export type AddItem = WordsItem | PictureItem | ShapeItem | InkItem | FieldItem;

/** One of JuraPDF's own additions, as remembered in the page (so it can be picked and changed again later). */
export interface Kept {
  id: number;
  item: AddItem;
  /** The box it covers (points from the page's top-left as shown). */
  box: Rect;
}

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

/** How solid a shape or pen drawing is (0–1), from its see-through percentage. */
export function opacityOf(item: Pick<ShapeItem, "seeThrough"> & { shape?: ShapeKind }): number {
  if (item.shape === "highlight") return HIGHLIGHT_OPACITY;
  return 1 - Math.min(90, Math.max(0, item.seeThrough ?? 0)) / 100;
}

/** Shapes that can be filled in. */
export const canFill = (shape: ShapeKind): boolean => shape === "box" || shape === "oval";

/** Colours offered with one click (as in most PDF readers), then "any colour". */
export const SWATCHES = ["#000000", "#1f2a37", "#d1373a", "#e07b00", "#ffd400", "#2e8b3a", "#1f5fbf", "#7b3fb5", "#ffffff"];
export const HIGHLIGHT_SWATCHES = ["#ffd400", "#7ee05c", "#5cc8ff", "#ff7ac6", "#ff9f40"];

export const DEFAULT_INK = { colour: "#1f5fbf", thickness: 2 };

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
const ALL_FONTS = Object.keys(FONT_NAMES) as FontChoice[];
const familyOf = (f: FontChoice): "sans" | "serif" | "mono" => (f.startsWith("Times") ? "serif" : f.startsWith("Courier") ? "mono" : "sans");
const SCREEN_FAMILY = {
  sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

export const BASELINE: Record<FontChoice, number> = Object.fromEntries(ALL_FONTS.map((f) => [f, { sans: 0.947, serif: 0.933, mono: 0.866 }[familyOf(f)]])) as Record<FontChoice, number>;

/** The closest screen font to each PDF font, for typing in. */
export const SCREEN_FONT: Record<FontChoice, { family: string; weight: number; style: "normal" | "italic" }> = Object.fromEntries(
  ALL_FONTS.map((f) => [f, { family: SCREEN_FAMILY[familyOf(f)], weight: f.includes("Bold") ? 700 : 400, style: /Italic|Oblique/.test(f) ? "italic" : "normal" }]),
) as Record<FontChoice, { family: string; weight: number; style: "normal" | "italic" }>;

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

/** What a thing added to a page is called ("a box", "an arrow", "some words"). */
export function itemName(item: AddItem): string {
  if (item.kind === "shape") return `${item.shape === "arrow" || item.shape === "oval" ? "an" : "a"} ${SHAPE_NAMES[item.shape].toLowerCase()}`;
  if (item.kind === "picture") return "a picture";
  if (item.kind === "ink") return "a drawing";
  if (item.kind === "field") return `a ${FIELD_NAMES[item.field].toLowerCase()}`;
  return "words";
}

/** What changing (or, with null, deleting) one of JuraPDF's own additions is called in the Undo list. */
export function changeLabel(was: AddItem, now: AddItem | null): string {
  const name = itemName(was);
  const where = `on page ${was.page + 1}`;
  if (!now) return `delete ${name} ${where}`;
  if (now.page !== was.page) return `move ${name} to page ${now.page + 1}`;
  return `${styleOf(was) === styleOf(now) ? "move" : "change"} ${name} ${where}`;
}

/** Everything about an item but where it is (for telling a move from a restyle). */
function styleOf(item: AddItem): string {
  const { x1, y1, x2, y2, strokes, x, y, width, height, page, id, own, preview, picture, ...rest } = item as unknown as Record<string, unknown>;
  void [x1, y1, x2, y2, strokes, x, y, width, height, page, id, preview, picture];
  return JSON.stringify({ ...rest, own: (own as OwnFont | undefined)?.base });
}

/** What a change is called in the Undo list. */
export function additionLabel(item: AddItem): string {
  if (item.kind === "shape") return `add ${itemName(item)} to page ${item.page + 1}`;
  if (item.kind === "picture") return item.signature ? `sign page ${item.page + 1}` : item.stamp ? `stamp “${item.stamp}” on page ${item.page + 1}` : `add a picture to page ${item.page + 1}`;
  if (item.kind === "ink") return `draw on page ${item.page + 1}`;
  if (item.kind === "field") return `add ${itemName(item)} to page ${item.page + 1}`;
  const first = linesOf(item.text)[0] ?? "";
  if (item.cover) return `change words on page ${item.page + 1} to “${first.length > 30 ? `${first.slice(0, 29)}…` : first}”`;
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
  /** For a stamp: its words (named so in Undo). */
  stamp?: string;
}

/** Waiting for a click on a page to put words or a chosen picture there (or, for "ink", drags to draw with). */
export type Placing = { kind: "words" } | { kind: "picture"; picture: ChosenPicture } | { kind: "shape"; shape: ShapeKind } | { kind: "change" } | { kind: "ink" } | { kind: "field"; field: FieldKind } | { kind: "redact" } | { kind: "note" } | { kind: "trim" };

/** A picture already on the page, being moved or sized. */
export interface ExistingPicture {
  kind: "existing";
  page: number;
  /** Which picture on the page (see src/pdf/pictures.ts). */
  n: number;
  /** Where it is now, and where it was (points from the page's top-left as shown). */
  x: number;
  y: number;
  width: number;
  height: number;
  from: Rect;
  /** A copy of how it looks, to show while it's moved (a data URL). */
  preview: string;
}

/** A picture being placed: a new one (`picture`), or one of JuraPDF's own being moved (`preview`). */
export type PictureDraft = PictureItem & { picture?: ChosenPicture; preview?: string };

/** Words or a picture on a page, being typed, moved or sized, not yet written into the PDF. */
export type Draft = WordsItem | PictureDraft | ShapeItem | InkItem | FieldItem | ExistingPicture;

/** The line of words a click landed on (boxes in points), or null. */
export function lineAt<T extends Rect>(lines: T[], x: number, y: number): T | null {
  const hits = lines.filter((l) => x >= l.x - 1 && x <= l.x + l.width + 1 && y >= l.y - 1 && y <= l.y + l.height + 1);
  return hits.sort((a, b) => a.width * a.height - b.width * b.height)[0] ?? null;
}

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

/** The box a pen drawing covers (allowing for how thick it is). */
export function inkBox(item: Pick<InkItem, "strokes" | "thickness">): Rect {
  const pts = item.strokes.flat();
  if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const pad = item.thickness / 2;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
}

/**
 * Thin out a pen stroke: points closer than `gap` points to the last one kept
 * are dropped (a hand-drawn line has far more than it needs), the last point stays.
 */
export function thinStroke(points: [number, number][], gap = 0.8): [number, number][] {
  if (points.length < 3) return points.map((p) => [p[0], p[1]]);
  const out: [number, number][] = [[points[0][0], points[0][1]]];
  for (const p of points.slice(1, -1)) {
    const last = out[out.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= gap) out.push([p[0], p[1]]);
  }
  const end = points[points.length - 1];
  out.push([end[0], end[1]]);
  return out.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

/** A smooth SVG path through a stroke's points (curves through the midpoints), in the units given by `k` per point. */
export function strokePath(points: [number, number][], k = 1): string {
  if (!points.length) return "";
  const p = points.map(([x, y]) => [x * k, y * k]);
  if (p.length === 1) return `M ${p[0][0]} ${p[0][1]} l 0.01 0`;
  let d = `M ${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2;
    const my = (p[i][1] + p[i + 1][1]) / 2;
    d += ` Q ${p[i][0]} ${p[i][1]} ${mx} ${my}`;
  }
  const last = p[p.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

/** How far a point is from a line segment. */
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const inside = (r: Rect, x: number, y: number, pad = 0) => x >= r.x - pad && x <= r.x + r.width + pad && y >= r.y - pad && y <= r.y + r.height + pad;

/**
 * Whether a click at (x, y) lands on a kept addition. `loose`: anywhere in a
 * box or oval counts (when picking things to change); otherwise only its
 * edge, unless it's filled (so words inside an empty box can still be picked).
 * `slack` is how near counts, in points.
 */
export function hits(k: Kept, x: number, y: number, loose: boolean, slack = 4): boolean {
  const item = k.item;
  if (item.kind === "shape" && (item.shape === "line" || item.shape === "arrow")) {
    return distanceToSegment(x, y, item.x1, item.y1, item.x2, item.y2) <= item.thickness / 2 + slack;
  }
  if (item.kind === "ink") {
    if (!inside(k.box, x, y, slack)) return false;
    return item.strokes.some((s) => s.length === 1 ? Math.hypot(x - s[0][0], y - s[0][1]) <= item.thickness / 2 + slack : s.slice(1).some((p, i) => distanceToSegment(x, y, s[i][0], s[i][1], p[0], p[1]) <= item.thickness / 2 + slack));
  }
  if (item.kind === "shape" && (item.shape === "box" || item.shape === "oval") && !loose && !item.fill) {
    if (!inside(k.box, x, y, slack)) return false;
    const b = k.box;
    if (item.shape === "box") return !inside({ x: b.x + slack + item.thickness, y: b.y + slack + item.thickness, width: b.width - 2 * (slack + item.thickness), height: b.height - 2 * (slack + item.thickness) }, x, y);
    // An oval's edge: where (x, y) sits compared with the ellipse.
    const rx = b.width / 2;
    const ry = b.height / 2;
    const r = Math.hypot((x - b.x - rx) / Math.max(rx, 0.1), (y - b.y - ry) / Math.max(ry, 0.1));
    return Math.abs(r - 1) * Math.min(rx, ry) <= slack + item.thickness;
  }
  return inside(k.box, x, y, slack / 2);
}

/** The topmost kept addition under a click (the last one drawn), or null. */
export function keptAt(kept: Kept[], x: number, y: number, loose: boolean): Kept | null {
  for (let i = kept.length - 1; i >= 0; i--) if (hits(kept[i], x, y, loose)) return kept[i];
  return null;
}

/** An addition moved by (dx, dy) points. */
export function moveItem<T extends AddItem>(item: T, dx: number, dy: number): T {
  if (item.kind === "shape") return { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy };
  if (item.kind === "ink") return { ...item, strokes: item.strokes.map((s) => s.map(([x, y]) => [x + dx, y + dy] as [number, number])) };
  return { ...item, x: item.x + dx, y: item.y + dy };
}

/** A pen drawing stretched from the box it fills (`from`) to another box (`to`). */
export function fitInk(item: InkItem, from: Rect, to: Rect): InkItem {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return { ...item, strokes: item.strokes.map((s) => s.map(([x, y]) => [to.x + (x - from.x) * sx, to.y + (y - from.y) * sy] as [number, number])) };
}

/** Read the additions remembered in a page (written by `keptText`); anything unreadable is left out. */
export function readKept(text: string | undefined): Kept[] {
  if (!text) return [];
  try {
    const list = JSON.parse(text) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((k): k is Kept => !!k && typeof k === "object" && Number.isInteger((k as Kept).id) && !!(k as Kept).item && !!(k as Kept).box);
  } catch {
    return [];
  }
}

/** The additions to remember in a page, as text. */
export function keptText(kept: Kept[]): string {
  return JSON.stringify(kept.map(({ id, item, box }) => ({ id, item: { ...item, id: undefined }, box })));
}
