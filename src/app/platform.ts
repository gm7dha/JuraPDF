/**
 * Which kind of computer JuraPDF is running on, so shortcuts can be shown
 * the way that computer's keyboard labels them (⌘ Cmd on a Mac, Ctrl on Windows).
 */
export type Platform = "mac" | "windows";

interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/** Mac (including iPad) or Windows-style (Windows, Linux, ChromeOS…). */
export function detectPlatform(nav: NavigatorLike | undefined = globalThis.navigator as NavigatorLike | undefined): Platform {
  if (!nav) return "windows";
  const hint = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(hint) ? "mac" : "windows";
}

export interface KeyNames {
  /** The main shortcut key: "⌘ Cmd" or "Ctrl". */
  mod: string;
  shift: string;
  /** The key that deletes things. */
  del: string;
}

export function keyNames(p: Platform): KeyNames {
  return p === "mac" ? { mod: "⌘ Cmd", shift: "⇧ Shift", del: "Delete ⌫" } : { mod: "Ctrl", shift: "Shift", del: "Delete" };
}

/** Short label for tooltips, e.g. "⌘Z" or "Ctrl+Z". */
export function shortcut(p: Platform, key: string, opts: { shift?: boolean } = {}): string {
  if (p === "mac") return `${opts.shift ? "⇧" : ""}⌘${key}`;
  return `Ctrl+${opts.shift ? "Shift+" : ""}${key}`;
}

/** Mouse and keyboard help rows for the Help dialog, worded for this kind of computer. */
export function helpRows(p: Platform) {
  const k = keyNames(p);
  const mac = p === "mac";
  const mouse: [string, string][] = [
    ["Scroll through the pages", "Scroll wheel, trackpad, or drag the scroll bar"],
    ["Zoom (towards the pointer)", mac ? `${k.mod} + scroll, or pinch on a trackpad` : `${k.mod} + scroll, or pinch on a trackpad`],
    ["Go to a page", "Click it in the page list on the left, or type its number in the box at the top"],
    ["Pick several pages", `${k.mod}-click them in the page list, or click one and Shift-click another for all those between`],
    ["Move pages", "Drag them up or down the page list, or use the move buttons at the top"],
    ["Turn, delete or add pages", "The page buttons at the top work on the picked pages, or the page you're on if none are picked"],
    ["Select and copy words", `Drag across them, then ${k.mod} + C`],
    ["Open a PDF", "Drag it onto the window"],
  ];
  const keys: [string, string][] = [
    ["← / →", "Previous / next page"],
    ["Home / End", "First / last page"],
    ["Delete", "Delete the picked pages (Undo brings them back)"],
    ["Esc", "Stop picking pages"],
    ["Page Up / Page Down", "Scroll up / down a screenful"],
    [`${k.mod} + + / −`, "Zoom in / out"],
    [`${k.mod} + 0`, "Fit the page's width to the window"],
    [`${k.mod} + 1`, "Real size (100%)"],
    [`${k.mod} + F`, "Find words (on the pages near where you are)"],
    [`${k.mod} + O`, "Open a PDF"],
    [`${k.mod} + S`, "Save the PDF to your computer"],
    [`${k.mod} + Z`, "Undo (e.g. take a watermark off again)"],
    [mac ? `${k.mod} + ${k.shift} + Z  or  ${k.mod} + Y` : `${k.mod} + Y  or  ${k.mod} + ${k.shift} + Z`, "Redo"],
    [`${k.mod} + P`, "Print (with an Uncontrolled Document watermark and your own words if you like)"],
    ["?", "Show this help"],
  ];
  return { mouse, keys };
}
