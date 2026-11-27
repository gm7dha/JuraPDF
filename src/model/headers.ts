/**
 * Headers and footers (pure): words along the top and bottom of pages, at the
 * left, middle or right, with the page number, the number of pages, the date
 * or the file's name filled in for each page. Also how page numbers are
 * counted (from which number, with leading zeros for "Bates" numbering) and
 * where each line goes, in points "as shown" (y up from the bottom).
 */
import { parsePageRange } from "./printMark";
import { FONT_NAMES, type FontChoice } from "./watermark";

export type Slot = "topLeft" | "topCentre" | "topRight" | "bottomLeft" | "bottomCentre" | "bottomRight";

export const SLOTS: Slot[] = ["topLeft", "topCentre", "topRight", "bottomLeft", "bottomCentre", "bottomRight"];

export const SLOT_NAMES: Record<Slot, string> = {
  topLeft: "Top left",
  topCentre: "Top middle",
  topRight: "Top right",
  bottomLeft: "Bottom left",
  bottomCentre: "Bottom middle",
  bottomRight: "Bottom right",
};

export interface HeaderSettings {
  /** The words for each spot ("" = nothing there). */
  text: Record<Slot, string>;
  font: FontChoice;
  /** Letter size in points. */
  size: number;
  colour: string;
  /** Distance from the page's edges, in points. */
  margin: number;
  /** Which pages: all, or a list like "2-5". */
  pages: "all" | "range";
  range: string;
  /** The number the first chosen page gets. */
  startAt: number;
  /** Page numbers at least this many digits long, with zeros in front ("Bates" numbers, e.g. 000123); 0 = as they are. */
  digits: number;
}

/** What can go in the words, filled in for each page. */
export const FIELDS = [
  { code: "{page}", name: "Page number" },
  { code: "{pages}", name: "Number of pages" },
  { code: "{date}", name: "Today's date" },
  { code: "{file}", name: "File name" },
] as const;

export const DEFAULT_HEADERS: HeaderSettings = {
  text: { topLeft: "", topCentre: "", topRight: "", bottomLeft: "", bottomCentre: "Page {page} of {pages}", bottomRight: "" },
  font: "Helvetica",
  size: 10,
  colour: "#333333",
  margin: 28,
  pages: "all",
  range: "",
  startAt: 1,
  digits: 0,
};

const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);

/** Settings from storage (or anywhere), with anything odd put back to the usual. */
export function cleanHeaders(raw: unknown): HeaderSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof HeaderSettings, unknown>>;
  const d = DEFAULT_HEADERS;
  const t = (r.text && typeof r.text === "object" ? r.text : {}) as Partial<Record<Slot, unknown>>;
  const text = Object.fromEntries(SLOTS.map((s) => [s, typeof t[s] === "string" ? (t[s] as string).slice(0, 200) : r.text ? "" : d.text[s]])) as Record<Slot, string>;
  return {
    text,
    font: typeof r.font === "string" && r.font in FONT_NAMES ? (r.font as FontChoice) : d.font,
    size: clamp(r.size, 4, 72, d.size),
    colour: typeof r.colour === "string" && /^#[0-9a-f]{6}$/i.test(r.colour) ? r.colour : d.colour,
    margin: clamp(r.margin, 0, 200, d.margin),
    pages: r.pages === "range" ? "range" : "all",
    range: typeof r.range === "string" ? r.range.slice(0, 200) : "",
    startAt: Math.round(clamp(r.startAt, 0, 9_999_999, d.startAt)),
    digits: Math.round(clamp(r.digits, 0, 12, 0)),
  };
}

/** Whether there are any words to put on. */
export const hasWords = (s: HeaderSettings) => SLOTS.some((k) => s.text[k].trim() !== "");

/** The pages (from 1) they go on, or a problem in words. */
export function headerPages(s: HeaderSettings, count: number): { pages: number[] } | { error: string } {
  if (s.pages === "all") return { pages: Array.from({ length: count }, (_, i) => i + 1) };
  if (!s.range.trim()) return { error: "Type which pages, e.g. 2-10." };
  return parsePageRange(s.range, count);
}

/** A number with zeros in front, at least `digits` long. */
export const padded = (n: number, digits: number) => String(n).padStart(digits, "0");

export interface PageFacts {
  /** The number this page gets (already counted from startAt). */
  number: number;
  /** How many pages are numbered (for "of {pages}"). */
  total: number;
  date: string;
  file: string;
}

/** The words with this page's facts filled in. */
export function fillCodes(text: string, f: PageFacts, digits: number): string {
  return text.replace(/\{(page|pages|date|file)\}/gi, (_, code: string) => {
    switch (code.toLowerCase()) {
      case "page":
        return padded(f.number, digits);
      case "pages":
        // The count of numbered pages, as the last one is numbered.
        return padded(f.total, digits);
      case "date":
        return f.date;
      default:
        return f.file;
    }
  });
}

/** Today's date as people write it here (e.g. 27 Nov 2026). */
export function dateText(d: Date, locale?: string): string {
  try {
    return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Each line for one page: its words, and where it starts (as shown, y up from the bottom, at the words' baseline). */
export function linesFor(
  s: HeaderSettings,
  facts: PageFacts,
  pageW: number,
  pageH: number,
  widthOf: (text: string) => number,
  ascent: number,
): { slot: Slot; text: string; x: number; y: number }[] {
  const out: { slot: Slot; text: string; x: number; y: number }[] = [];
  for (const slot of SLOTS) {
    const text = fillCodes(s.text[slot], facts, s.digits).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const w = widthOf(text);
    const x = slot.endsWith("Left") ? s.margin : slot.endsWith("Right") ? pageW - s.margin - w : (pageW - w) / 2;
    // A header's tops of letters sit `margin` down from the top; a footer's baseline sits `margin` up from the bottom.
    const y = slot.startsWith("top") ? pageH - s.margin - ascent : s.margin;
    out.push({ slot, text, x, y });
  }
  return out;
}

/** A short description for messages ("page numbers", "a header and footer"). */
export function headersLabel(s: HeaderSettings): string {
  const top = SLOTS.slice(0, 3).some((k) => s.text[k].trim());
  const bottom = SLOTS.slice(3).some((k) => s.text[k].trim());
  const onlyNumbers = SLOTS.every((k) => !s.text[k].trim() || /^\s*(page\s*)?\{page\}(\s*(of|\/)\s*\{pages\})?\s*$/i.test(s.text[k]));
  if (onlyNumbers) return "page numbers";
  if (top && bottom) return "a header and footer";
  return top ? "a header" : "a footer";
}
