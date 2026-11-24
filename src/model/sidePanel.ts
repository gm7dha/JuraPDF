/** How wide the side panel (Pages / Bookmarks) is, and how big the page pictures in it are. Pure. */
import type { SidePane } from "./store";

/** The width each pane starts at, in CSS pixels. */
export const DEFAULT_SIDE_WIDTH: Record<SidePane, number> = { pages: 168, bookmarks: 250 };
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
    for (const pane of ["pages", "bookmarks"] as const) {
      const w = got?.[pane];
      if (typeof w === "number" && Number.isFinite(w)) out[pane] = Math.round(Math.min(MAX_SIDE_WIDTH, Math.max(MIN_SIDE_WIDTH, w)));
    }
  } catch {
    // Not readable: the starting widths.
  }
  return out;
}
