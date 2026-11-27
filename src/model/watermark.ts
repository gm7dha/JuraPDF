/**
 * Watermarks saved into the PDF: the choices, and where each copy goes on a
 * page. Pure, so it can be tested; `src/pdf/watermark.ts` does the writing.
 *
 * Positions here are in "as shown" page space: points, x right, y up, with
 * (0, 0) the bottom-left corner of the page as it shows on screen (after any
 * turn the PDF gives the page). `toPageSpace` turns them into the page's own
 * space for writing.
 */
import { parsePageRange } from "./printMark";

export type WatermarkKind = "words" | "picture";
export type FontChoice =
  | "Helvetica"
  | "HelveticaBold"
  | "HelveticaOblique"
  | "HelveticaBoldOblique"
  | "TimesRoman"
  | "TimesRomanBold"
  | "TimesRomanItalic"
  | "TimesRomanBoldItalic"
  | "Courier"
  | "CourierBold"
  | "CourierOblique"
  | "CourierBoldOblique";
export type AngleChoice = "diagonal" | "level" | "custom";
export type Placement = "middle" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "repeat";
export type PageChoice = "all" | "odd" | "even" | "range";

export interface WatermarkSettings {
  kind: WatermarkKind;
  /** The words (one line). */
  text: string;
  font: FontChoice;
  /** "#rrggbb". */
  colour: string;
  /** Words: fill the page, or a set letter size. */
  sizeMode: "fit" | "set";
  /** Letter size in points, when set. */
  size: number;
  /** Picture: its width as a percentage of the page's width. */
  pictureWidth: number;
  angle: AngleChoice;
  /** Degrees, rising to the right, when the angle is custom. */
  customAngle: number;
  placement: Placement;
  /** How see-through, 0 (solid) to 95 (barely there), in percent. */
  seeThrough: number;
  /** Behind what's on the page (true), or in front of it. */
  behind: boolean;
  pages: PageChoice;
  /** Pages typed when `pages` is "range", e.g. "1-3, 5". */
  range: string;
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  kind: "words",
  text: "CONFIDENTIAL",
  font: "HelveticaBold",
  colour: "#d1373a",
  sizeMode: "fit",
  size: 60,
  pictureWidth: 50,
  angle: "diagonal",
  customAngle: 30,
  placement: "middle",
  seeThrough: 70,
  behind: false,
  pages: "all",
  range: "",
};

export const FONT_NAMES: Record<FontChoice, string> = {
  Helvetica: "Helvetica (plain)",
  HelveticaBold: "Helvetica bold",
  HelveticaOblique: "Helvetica slanted",
  HelveticaBoldOblique: "Helvetica bold slanted",
  TimesRoman: "Times (plain)",
  TimesRomanBold: "Times bold",
  TimesRomanItalic: "Times slanted",
  TimesRomanBoldItalic: "Times bold slanted",
  Courier: "Courier (typewriter)",
  CourierBold: "Courier bold",
  CourierOblique: "Courier slanted",
  CourierBoldOblique: "Courier bold slanted",
};

/** The built-in font nearest to one described as serif, typewriter or plain, bold and/or slanted. */
export function nearestFont(family: "sans" | "serif" | "mono", bold: boolean, slanted: boolean): FontChoice {
  const base = family === "serif" ? "TimesRoman" : family === "mono" ? "Courier" : "Helvetica";
  const tail = family === "serif" ? (bold ? (slanted ? "BoldItalic" : "Bold") : slanted ? "Italic" : "") : bold ? (slanted ? "BoldOblique" : "Bold") : slanted ? "Oblique" : "";
  return `${base}${tail}` as FontChoice;
}

export const PLACEMENT_NAMES: Record<Placement, string> = {
  middle: "In the middle",
  top: "Top",
  bottom: "Bottom",
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
  repeat: "Repeated across the page",
};

/** Keep settings read from this computer sensible, whatever was saved. */
export function cleanSettings(raw: unknown): WatermarkSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<WatermarkSettings>;
  const d = DEFAULT_WATERMARK;
  const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  return {
    kind: pick(r.kind, ["words", "picture"], d.kind),
    text: typeof r.text === "string" ? r.text.slice(0, 200) : d.text,
    font: pick(r.font, Object.keys(FONT_NAMES) as FontChoice[], d.font),
    colour: typeof r.colour === "string" && /^#[0-9a-f]{6}$/i.test(r.colour) ? r.colour : d.colour,
    sizeMode: pick(r.sizeMode, ["fit", "set"], d.sizeMode),
    size: num(r.size, 4, 400, d.size),
    pictureWidth: num(r.pictureWidth, 5, 100, d.pictureWidth),
    angle: pick(r.angle, ["diagonal", "level", "custom"], d.angle),
    customAngle: num(r.customAngle, -180, 180, d.customAngle),
    placement: pick(r.placement, Object.keys(PLACEMENT_NAMES) as Placement[], d.placement),
    seeThrough: num(r.seeThrough, 0, 95, d.seeThrough),
    behind: typeof r.behind === "boolean" ? r.behind : d.behind,
    pages: pick(r.pages, ["all", "odd", "even", "range"], d.pages),
    range: typeof r.range === "string" ? r.range.slice(0, 200) : d.range,
  };
}

/** The pages (1-based) a watermark goes on, or what's wrong with the typed pages. */
export function choosePages(s: WatermarkSettings, count: number): { pages: number[] } | { error: string } {
  const all = Array.from({ length: count }, (_, i) => i + 1);
  if (s.pages === "all") return { pages: all };
  if (s.pages === "odd") return { pages: all.filter((p) => p % 2 === 1) };
  if (s.pages === "even") return all.length > 1 ? { pages: all.filter((p) => p % 2 === 0) } : { error: "This PDF has only one page, so there are no even pages." };
  if (!s.range.trim()) return { error: "Type the pages to watermark, e.g. 1-3, 5." };
  return parsePageRange(s.range, count);
}

/** "#d1373a" → [0.82, 0.22, 0.23]. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/** The watermark's turn in degrees (rising to the right) on a page `w` × `h` as shown. */
export function angleFor(s: WatermarkSettings, w: number, h: number): number {
  if (s.angle === "level") return 0;
  if (s.angle === "custom") return s.customAngle;
  return (Math.atan2(h, w) * 180) / Math.PI;
}

/** One copy of the watermark: its middle (as shown, y up) and turn in degrees. */
export interface Stamp {
  x: number;
  y: number;
  angle: number;
}

/** The box a `w` × `h` item takes up once turned by `deg`. */
export function turnedBox(w: number, h: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return [w * c + h * s, w * s + h * c];
}

/** How much of the page a "fill the page" watermark takes up, and the gap kept from the edges. */
const FILL = 0.86;
const EDGE = 0.05;

/**
 * The scale that makes an item of `w` × `h` (at scale 1), turned by `deg`,
 * fill the page `pw` × `ph` as fully as fits.
 */
export function fitScale(w: number, h: number, deg: number, pw: number, ph: number): number {
  const [bw, bh] = turnedBox(w, h, deg);
  if (bw <= 0 || bh <= 0) return 1;
  return Math.min((FILL * pw) / bw, (FILL * ph) / bh);
}

/**
 * Where the copies of a `w` × `h` item (already at its final size) go on a
 * page `pw` × `ph` as shown.
 */
export function stampsFor(placement: Placement, w: number, h: number, deg: number, pw: number, ph: number): Stamp[] {
  const [bw, bh] = turnedBox(w, h, deg);
  const m = EDGE * Math.min(pw, ph);
  const left = m + bw / 2;
  const right = pw - m - bw / 2;
  const top = ph - m - bh / 2;
  const bottom = m + bh / 2;
  const at = (x: number, y: number): Stamp[] => [{ x, y, angle: deg }];
  switch (placement) {
    case "middle":
      return at(pw / 2, ph / 2);
    case "top":
      return at(pw / 2, top);
    case "bottom":
      return at(pw / 2, bottom);
    case "top-left":
      return at(left, top);
    case "top-right":
      return at(right, top);
    case "bottom-left":
      return at(left, bottom);
    case "bottom-right":
      return at(right, bottom);
    case "repeat":
      return repeated(w, h, deg, pw, ph);
  }
}

/** Copies in rows along the slant, every other row shifted half a step, covering the whole page. */
function repeated(w: number, h: number, deg: number, pw: number, ph: number): Stamp[] {
  const a = (deg * Math.PI) / 180;
  const along: [number, number] = [Math.cos(a), Math.sin(a)];
  const across: [number, number] = [-Math.sin(a), Math.cos(a)];
  const stepAlong = w + Math.max(h * 1.5, 0.08 * Math.min(pw, ph));
  const stepAcross = h * 3;
  const reach = Math.hypot(pw, ph) / 2 + Math.max(w, h);
  const cx = pw / 2;
  const cy = ph / 2;
  const stamps: Stamp[] = [];
  const rows = Math.ceil(reach / stepAcross);
  const cols = Math.ceil(reach / stepAlong) + 1;
  for (let j = -rows; j <= rows; j++) {
    const shift = (j & 1 ? 0.5 : 0) * stepAlong;
    for (let i = -cols; i <= cols; i++) {
      const u = i * stepAlong + shift;
      const v = j * stepAcross;
      const x = cx + along[0] * u + across[0] * v;
      const y = cy + along[1] * u + across[1] * v;
      // Keep copies that land at least partly on the page.
      const [bw, bh] = turnedBox(w, h, deg);
      if (x + bw / 2 < 0 || x - bw / 2 > pw || y + bh / 2 < 0 || y - bh / 2 > ph) continue;
      stamps.push({ x, y, angle: deg });
    }
  }
  return stamps;
}

/** A page's visible box in its own space (its crop box), and how the PDF turns it to show it. */
export interface PageFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0, 90, 180 or 270 degrees clockwise. */
  rotation: number;
}

/** The page's size as it shows (turned pages swap width and height). */
export function shownSize(f: PageFrame): [number, number] {
  const r = normalRotation(f.rotation);
  return r === 90 || r === 270 ? [f.height, f.width] : [f.width, f.height];
}

export function normalRotation(r: number): 0 | 90 | 180 | 270 {
  const n = ((Math.round(r / 90) * 90) % 360 + 360) % 360;
  return n as 0 | 90 | 180 | 270;
}

/** A point and turn as shown → the page's own space, where the PDF is written. */
export function toPageSpace(f: PageFrame, x: number, y: number, angle: number): Stamp {
  const r = normalRotation(f.rotation);
  switch (r) {
    case 0:
      return { x: f.x + x, y: f.y + y, angle };
    case 90:
      return { x: f.x + f.width - y, y: f.y + x, angle: angle + 90 };
    case 180:
      return { x: f.x + f.width - x, y: f.y + f.height - y, angle: angle + 180 };
    case 270:
      return { x: f.x + y, y: f.y + f.height - x, angle: angle + 270 };
  }
}

/**
 * Where to start writing an item `w` × `h` so its middle lands on (x, y)
 * once turned by `deg` about its start (bottom-left) corner, which is how PDF
 * writing tools turn things.
 */
export function startCorner(x: number, y: number, w: number, h: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x - (c * w) / 2 + (s * h) / 2, y - (s * w) / 2 - (c * h) / 2];
}
