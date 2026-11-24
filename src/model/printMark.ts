/**
 * The print watermark: "UNCONTROLLED DOCUMENT" and/or a work order number,
 * written large and see-through, corner to corner across each printed page.
 * Pure (the drawing itself is in src/app/printing.ts), so it can be tested.
 */

export interface PrintMark {
  /** Write "UNCONTROLLED DOCUMENT" across the page. */
  uncontrolled: boolean;
  /** A work order number (or anything else) to write too. Blank = none. */
  workOrder: string;
}

export const NO_MARK: PrintMark = { uncontrolled: false, workOrder: "" };

export const UNCONTROLLED_TEXT = "UNCONTROLLED DOCUMENT";

/** The mark's colour (a strong red) and how see-through it is (0 = invisible, 1 = solid). */
export const MARK_COLOUR = "#d1373a";
export const MARK_ALPHA = 0.4;

export function hasMark(mark: PrintMark): boolean {
  return mark.uncontrolled || mark.workOrder.trim() !== "";
}

/** "Work Order: 12345" (or "" when there's none). */
export function workOrderText(mark: PrintMark): string {
  const wo = mark.workOrder.trim();
  return wo ? `Work Order: ${wo}` : "";
}

/** One line of the mark: its words, letter size and where its middle goes (page units, y down). */
export interface MarkLine {
  text: string;
  size: number;
  bold: boolean;
  x: number;
  y: number;
}

export interface MarkLayout {
  /** Turn, in radians (negative = rising to the right), about each line's middle. */
  angle: number;
  lines: MarkLine[];
}

/**
 * Lay the mark out on a page `w` × `h` (any units, y down). `measure(text, size, bold)`
 * gives a line's width. The main line fills about three quarters of the diagonal;
 * the work order sits under it, smaller, on the same slant.
 */
export function layoutMark(mark: PrintMark, w: number, h: number, measure: (text: string, size: number, bold: boolean) => number): MarkLayout | null {
  if (!hasMark(mark) || w <= 0 || h <= 0) return null;
  const angle = -Math.atan2(h, w);
  const diagonal = Math.hypot(w, h);
  const room = diagonal * 0.74;
  const cap = Math.min(w, h) * 0.14;
  const fit = (text: string, bold: boolean, most: number) => Math.min(most, room / Math.max(1e-6, measure(text, 1, bold)));

  const wo = workOrderText(mark);
  const texts: { text: string; bold: boolean; size: number }[] = [];
  if (mark.uncontrolled) {
    texts.push({ text: UNCONTROLLED_TEXT, bold: true, size: fit(UNCONTROLLED_TEXT, true, cap) });
    if (wo) texts.push({ text: wo, bold: false, size: fit(wo, false, texts[0].size * 0.55) });
  } else {
    texts.push({ text: wo, bold: true, size: fit(wo, true, cap) });
  }

  // Stack the lines (gap = 0.35 of the smaller), centred on the page's middle, across the slant.
  const gap = texts.length > 1 ? Math.min(...texts.map((t) => t.size)) * 0.35 : 0;
  const total = texts.reduce((sum, t) => sum + t.size, 0) + gap * (texts.length - 1);
  // "Down" across the slanted lines: the line direction turned a quarter turn.
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  let offset = -total / 2;
  const lines = texts.map((t) => {
    const middle = offset + t.size / 2;
    offset += t.size + gap;
    return { text: t.text, size: t.size, bold: t.bold, x: w / 2 + nx * middle, y: h / 2 + ny * middle };
  });
  return { angle, lines };
}

/**
 * Read which pages to print: "" or "all" = every page; otherwise numbers and
 * ranges such as "1-3, 5, 8-". Returns the pages (1 to count, in order, no
 * repeats), or an error to show.
 */
export function parsePageRange(text: string, count: number): { pages: number[] } | { error: string } {
  const t = text.trim().toLowerCase();
  if (t === "" || t === "all") return { pages: Array.from({ length: count }, (_, i) => i + 1) };
  const chosen = new Set<number>();
  for (const part of t.replace(/\s*[-–]\s*/g, "-").split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d*)-(\d*)$/);
    if (m && (m[1] || m[2])) {
      const from = m[1] ? Number(m[1]) : 1;
      const to = m[2] ? Number(m[2]) : count;
      if (from < 1 || to < 1 || from > count) return { error: `There's no page ${from > count ? from : Math.min(from, to)}. This PDF has ${count} ${count === 1 ? "page" : "pages"}.` };
      if (from > to) return { error: `"${part}" goes backwards. Try ${to}-${from}.` };
      for (let p = from; p <= Math.min(to, count); p++) chosen.add(p);
    } else if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (p < 1 || p > count) return { error: `There's no page ${p}. This PDF has ${count} ${count === 1 ? "page" : "pages"}.` };
      chosen.add(p);
    } else {
      return { error: `"${part}" isn't a page number. Type pages like 1-3, 5.` };
    }
  }
  return { pages: [...chosen].sort((a, b) => a - b) };
}
