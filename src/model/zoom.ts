/**
 * Zoom and page-position maths for the page view. Pure, so it can be tested.
 *
 * Page sizes are in PDF points (72 to the inch). At 100% a page shows at its
 * real size on screen, which is 96 CSS pixels to the inch, the same as
 * Chrome's and Adobe's PDF viewers.
 */

/** CSS pixels per PDF point at 100%. */
export const CSS_PER_PT = 96 / 72;

/** Zoom levels the − and + buttons step through. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** A fixed zoom (1 = 100%), or one that follows the window's size. */
export type ZoomMode = number | "width" | "page";

/** Room left round the pages, in CSS pixels: the gap at the sides, and above and below. */
export const PAGE_MARGIN_X = 24;
export const PAGE_MARGIN_Y = 16;
/** Gap between pages, in CSS pixels. */
export const PAGE_GAP = 14;

export type Size = [width: number, height: number];

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** The zoom that makes the widest page fill the window's width. */
export function fitWidthZoom(pages: Size[], view: Size): number {
  const widest = Math.max(1, ...pages.map((p) => p[0]));
  return clampZoom((view[0] - 2 * PAGE_MARGIN_X) / (widest * CSS_PER_PT));
}

/** The zoom that shows one whole page (the biggest) in the window. */
export function fitPageZoom(pages: Size[], view: Size): number {
  const widest = Math.max(1, ...pages.map((p) => p[0]));
  const tallest = Math.max(1, ...pages.map((p) => p[1]));
  return clampZoom(Math.min((view[0] - 2 * PAGE_MARGIN_X) / (widest * CSS_PER_PT), (view[1] - 2 * PAGE_MARGIN_Y) / (tallest * CSS_PER_PT)));
}

/** The zoom a mode works out to for these pages in a window of this size. */
export function resolveZoom(mode: ZoomMode, pages: Size[], view: Size): number {
  if (mode === "width") return fitWidthZoom(pages, view);
  if (mode === "page") return fitPageZoom(pages, view);
  return clampZoom(mode);
}

/** The next zoom step up from `z`. */
export function zoomIn(z: number): number {
  return ZOOM_STEPS.find((s) => s > z * 1.001) ?? MAX_ZOOM;
}

/** The next zoom step down from `z`. */
export function zoomOut(z: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < z / 1.001) return ZOOM_STEPS[i];
  return MIN_ZOOM;
}

/** "125%". */
export function zoomLabel(z: number): string {
  return `${Math.round(z * 100)}%`;
}

/** Read a typed zoom: "150", "150%" or "1.5x". Null if it isn't one. */
export function parseZoom(text: string): number | null {
  const t = text.trim().toLowerCase();
  let m = t.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  if (m) return clampZoom(Number(m[1]) / 100);
  m = t.match(/^(\d+(?:\.\d+)?)\s*x$/);
  if (m) return clampZoom(Number(m[1]));
  return null;
}

/** Read a typed page number (1 to count). Null if it isn't one. */
export function parsePageNumber(text: string, count: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t) || count < 1) return null;
  const n = Number(t);
  return Math.min(count, Math.max(1, n));
}

/** Where each page sits in the scrolling view at a zoom: its top, and its size on screen, in CSS pixels. */
export interface PageBox {
  top: number;
  width: number;
  height: number;
}

export function layoutPages(pages: Size[], zoom: number): { boxes: PageBox[]; height: number; width: number } {
  const k = zoom * CSS_PER_PT;
  let y = PAGE_MARGIN_Y;
  let width = 0;
  const boxes = pages.map(([w, h]) => {
    const box = { top: y, width: Math.round(w * k), height: Math.round(h * k) };
    y += box.height + PAGE_GAP;
    width = Math.max(width, box.width);
    return box;
  });
  return { boxes, height: y - (pages.length ? PAGE_GAP : 0) + PAGE_MARGIN_Y, width: width + 2 * PAGE_MARGIN_X };
}

/**
 * The page being read: the one that fills most of the window (the first one,
 * on a tie). Pages are given as `layoutPages` boxes.
 */
export function currentPageAt(boxes: PageBox[], scrollTop: number, viewHeight: number): number {
  let best = 0;
  let bestShown = -1;
  const bottom = scrollTop + viewHeight;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.top > bottom) break;
    const shown = Math.min(bottom, b.top + b.height) - Math.max(scrollTop, b.top);
    if (shown > bestShown + 0.5) {
      best = i;
      bestShown = shown;
    }
  }
  return best;
}

/**
 * Where to scroll after the zoom changes so the same spot stays under `anchorY`
 * (a height in the window, e.g. the pointer, or 0 for the top edge).
 */
export function keepSpotInView(
  before: PageBox[],
  after: PageBox[],
  scrollTop: number,
  anchorY: number,
): number {
  const y = scrollTop + anchorY;
  // The page under the anchor (or the last one above it), and how far down it the anchor is.
  let i = 0;
  while (i + 1 < before.length && before[i + 1].top <= y) i++;
  const b = before[i];
  const a = after[i];
  if (!b || !a) return scrollTop;
  const fraction = b.height > 0 ? (y - b.top) / b.height : 0;
  return Math.max(0, a.top + fraction * a.height - anchorY);
}

/** How far the wheel must turn (CSS pixels) to flip to the next page when showing one page at a time. */
export const FLIP_DISTANCE = 80;

/** A pause between wheel events this long (ms) means a new turn of the wheel, not the same glide. */
export const WHEEL_PAUSE = 70;

/**
 * One page at a time: which pages to draw ahead, most wanted first. Three
 * further on in the way you're going (−1 back, +1 on), then one the other way.
 */
export function pagesAhead(page: number, way: 1 | -1, count: number): number[] {
  const order = [page + way, page + 2 * way, page + 3 * way, page - way];
  return order.filter((n) => n >= 0 && n < count);
}

/**
 * Whether to let a wheel event go by after a flip: until `restUntil`, unless
 * the wheel paused first (`gap` ms since the last event), which is a fresh
 * turn of the wheel (flicking quickly through pages) rather than a trackpad's
 * glide carrying on.
 */
export function wheelResting(now: number, restUntil: number, gap: number): boolean {
  return now < restUntil && gap < WHEEL_PAUSE;
}

/**
 * One page at a time: add a wheel turn to the turn so far and say whether to
 * flip a page (+1 next, −1 previous). A turn the other way starts again.
 * `canScroll` is false while the page fits the window, or when it's already
 * scrolled as far as it goes in that direction (then the wheel flips instead).
 */
export function wheelFlip(total: number, deltaY: number, canScroll: boolean): { total: number; flip: -1 | 0 | 1 } {
  if (canScroll || deltaY === 0) return { total: 0, flip: 0 };
  const sum = Math.sign(total) === Math.sign(deltaY) ? total + deltaY : deltaY;
  if (sum >= FLIP_DISTANCE) return { total: 0, flip: 1 };
  if (sum <= -FLIP_DISTANCE) return { total: 0, flip: -1 };
  return { total: sum, flip: 0 };
}

/**
 * Which pages to have on hand: those within `margin` pixels above or below
 * the window (from, to: page numbers from 0, `to` included). Boxes are in
 * order down the page, so this finds them by halving rather than looking at
 * every page (quick for PDFs with thousands of pages).
 */
export function pagesInView(boxes: { top: number; height: number }[], scrollTop: number, viewHeight: number, margin: number): [number, number] {
  if (!boxes.length) return [0, -1];
  const top = scrollTop - margin;
  const bottom = scrollTop + viewHeight + margin;
  // The first page whose bottom is below `top`.
  let lo = 0;
  let hi = boxes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (boxes[mid].top + boxes[mid].height < top) lo = mid + 1;
    else hi = mid;
  }
  const from = lo;
  // The last page whose top is above `bottom`.
  lo = from;
  hi = boxes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (boxes[mid].top > bottom) hi = mid - 1;
    else lo = mid;
  }
  return [from, Math.max(from, lo)];
}
