/**
 * Pictures already on a page: where each one shows, and the sums for moving
 * or resizing it. A picture is drawn by stretching a 1 × 1 square with the
 * page's current "matrix" (six numbers: how it's scaled, turned and placed),
 * so all of this is sums with those six numbers.
 */
import { normalRotation, type PageFrame } from "./watermark";
import type { Rect } from "./additions";

/** [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (as in a PDF). */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` then `n` (a point goes through m first). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
}

export function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** A point in the page's own space as shown: points from the shown page's bottom-left, y up (undoes toPageSpace). */
export function fromPageSpace(f: PageFrame, px: number, py: number): [number, number] {
  switch (normalRotation(f.rotation)) {
    case 0:
      return [px - f.x, py - f.y];
    case 90:
      return [py - f.y, f.x + f.width - px];
    case 180:
      return [f.x + f.width - px, f.y + f.height - py];
    case 270:
      return [f.y + f.height - py, px - f.x];
  }
}

const shownHeight = (f: PageFrame) => (normalRotation(f.rotation) % 180 ? f.width : f.height);

/** The page's own space → as shown from the top-left, y down (how the app places things). */
export function pageToShown(f: PageFrame): Matrix {
  const [ox, oy] = fromPageSpace(f, 0, 0);
  const [xx, xy] = fromPageSpace(f, 1, 0);
  const [yx, yy] = fromPageSpace(f, 0, 1);
  const h = shownHeight(f);
  // Shown y-up to top-left y-down: y' = h - y.
  return [xx - ox, -(xy - oy), yx - ox, -(yy - oy), ox, h - oy];
}

/** Where a picture drawn with `ctm` shows: the box around it, points from the shown page's top-left. */
export function shownBox(f: PageFrame, ctm: Matrix): Rect {
  const m = multiply(ctm, pageToShown(f));
  const corners = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The extra matrix to put just before a picture is drawn (with `ctm`) so it
 * shows in box `to` instead of `from` (both as shown), stretched to fit.
 */
export function moveMatrix(f: PageFrame, ctm: Matrix, from: Rect, to: Rect): Matrix {
  const shown = pageToShown(f);
  const back = invert(shown) ?? IDENTITY;
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  // In the shown space: scale about `from`'s corner, then move it to `to`'s.
  const inShown: Matrix = [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy];
  // Page space → shown → moved → back to page space.
  const s = multiply(multiply(shown, inShown), back);
  // The new drawing matrix is ctm then s; written as "M cm" before the old ctm: M = ctm · s · ctm⁻¹.
  const ctmBack = invert(ctm) ?? IDENTITY;
  return multiply(multiply(ctm, s), ctmBack);
}

/** Fit a picture `w` × `h` (its own shape) inside `box`, centred. */
export function fitInside(box: Rect, w: number, h: number): Rect {
  if (w <= 0 || h <= 0) return box;
  const scale = Math.min(box.width / w, box.height / h);
  const width = w * scale;
  const height = h * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/** A matrix's six numbers, tidily, for writing into a page. */
export function matrixText(m: Matrix): string {
  return m.map((v) => (Math.abs(v) < 1e-9 ? "0" : String(Math.round(v * 1e6) / 1e6))).join(" ");
}


/**
 * The extra matrix to put just before drawing a picture (where the matrix is
 * `ctm`) so it fills `box` (as shown), upright as the page shows, whatever
 * way the page's own drawing is turned.
 */
export function placeMatrix(f: PageFrame, ctm: Matrix, box: Rect): Matrix {
  // The 1 × 1 square's bottom-left goes to the box's bottom-left (as shown, y down), its top-right to the box's top-right.
  const inShown: Matrix = [box.width, 0, 0, -box.height, box.x, box.y + box.height];
  const target = multiply(inShown, invert(pageToShown(f)) ?? IDENTITY);
  return multiply(target, invert(ctm) ?? IDENTITY);
}
