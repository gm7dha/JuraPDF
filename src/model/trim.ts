/**
 * Trimming pages (cropping), pure: the box to keep, as margins from the page's
 * edges as shown (so the same trim suits pages of other sizes), and that box
 * in the page's own space, where the PDF keeps it (its crop box).
 */
import { toPageSpace, type PageFrame } from "./watermark";

/** How much to trim off each edge, in points, as the page shows. */
export interface Margins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A box in points from the page's top-left, as shown. */
export interface ShownBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What's left of a page after trimming can't be smaller than this (half an inch). */
export const LEAST_LEFT = 36;

/** The margins for keeping `box` of a page `w` × `h` (as shown), none below 0. */
export function marginsFor(box: ShownBox, w: number, h: number): Margins {
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  return { left, top, right: Math.max(0, w - (box.x + box.width)), bottom: Math.max(0, h - (box.y + box.height)) };
}

/** The box kept on a page `w` × `h` with these margins; null when too little would be left. */
export function keptBox(m: Margins, w: number, h: number): ShownBox | null {
  const width = w - m.left - m.right;
  const height = h - m.top - m.bottom;
  if (width < LEAST_LEFT || height < LEAST_LEFT || m.left < 0 || m.top < 0 || m.right < 0 || m.bottom < 0) return null;
  return { x: m.left, y: m.top, width, height };
}

/** A box as shown (from the top-left) → the same box in the page's own space (from its bottom-left). */
export function ownBox(f: PageFrame, box: ShownBox, shownHeight: number): ShownBox {
  // toPageSpace takes y up from the bottom as shown.
  const a = toPageSpace(f, box.x, shownHeight - box.y - box.height, 0);
  const b = toPageSpace(f, box.x + box.width, shownHeight - box.y, 0);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Any trim at all? (Less than a hundredth of a point doesn't count.) */
export const trims = (m: Margins) => Math.max(m.left, m.top, m.right, m.bottom) > 0.01;

/** Margins in a few words, e.g. "1.2 cm off the left, 0.5 cm off the top". */
export function marginsLabel(m: Margins): string {
  const cm = (pt: number) => `${(Math.round((pt / 72) * 2.54 * 10) / 10).toLocaleString("en-GB")} cm`;
  const parts = (["left", "top", "right", "bottom"] as const).filter((k) => m[k] > 0.5).map((k) => `${cm(m[k])} off the ${k}`);
  return parts.length ? parts.join(", ") : "nothing";
}
