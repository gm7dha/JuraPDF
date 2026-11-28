/** How wide the side panel (Pages / Bookmarks / Notes / Changes) is, and how big the page pictures in it are. Pure. */
import type { SidePane } from "./store";

/** The width each pane starts at, in CSS pixels. */
export const DEFAULT_SIDE_WIDTH: Record<SidePane, number> = { pages: 168, bookmarks: 250, notes: 260, changes: 280 };
export const MIN_SIDE_WIDTH = 130;
/** The panel never takes more than this much of the window, so the pages always have room. */
const MOST_OF_WINDOW = 0.6;
const MAX_SIDE_WIDTH = 720;

/** A width kept between the smallest and the largest that fit a window this wide. */
export function clampSideWidth(width: number, windowWidth: number): number {
  const most = Math.max(MIN_SIDE_WIDTH, Math.min(MAX_SIDE_WIDTH, Math.floor(windowWidth * MOST_OF_WINDOW)));
  if (!Number.isFinite(width)) return MIN_SIDE_WIDTH;
  return Math.round(Math.min(most, Math.max(MIN_SIDE_WIDTH, width)));
}

/** How wide the page pictures are in a Pages panel this wide (room left for the frame and the scroll bar). */
export function thumbWidthFor(panelWidth: number): number {
  return Math.max(80, Math.round(panelWidth - 48));
}

/** Widths remembered on this computer, tidied (anything odd gives the starting width). */
export function readSideWidths(saved: string | null): Record<SidePane, number> {
  const out = { ...DEFAULT_SIDE_WIDTH };
  try {
    const got = saved ? (JSON.parse(saved) as Partial<Record<SidePane, unknown>>) : null;
    for (const pane of ["pages", "bookmarks", "notes", "changes"] as const) {
      const w = got?.[pane];
      if (typeof w === "number" && Number.isFinite(w)) out[pane] = Math.round(Math.min(MAX_SIDE_WIDTH, Math.max(MIN_SIDE_WIDTH, w)));
    }
  } catch {
    // Not readable: the starting widths.
  }
  return out;
}

/** Room round each page picture in the list: its frame, padding and number underneath, in CSS pixels. */
export const THUMB_EXTRA = 34;
const THUMB_GAP = 4;
const THUMB_PAD = 12;

/** Where each page picture sits down the list (top and height, in CSS pixels), and how tall the list is. */
export function thumbLayout(sizes: [number, number][], thumbWidth: number): { boxes: { top: number; height: number }[]; height: number } {
  let y = THUMB_PAD;
  const boxes = sizes.map(([w, h]) => {
    const box = { top: y, height: Math.round((h * thumbWidth) / Math.max(1, w)) + THUMB_EXTRA };
    y += box.height + THUMB_GAP;
    return box;
  });
  return { boxes, height: y - (sizes.length ? THUMB_GAP : 0) + THUMB_PAD };
}
