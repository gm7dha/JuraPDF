import { create } from "zustand";

import type { PDFDocumentProxy } from "../pdf/pdfjs";
import { pickPages, type ClickKind } from "./pages";
import type { Draft, Placing } from "./additions";
import type { CompareState } from "./compare";
import type { OpenNote } from "./notes";
import type { SearchState } from "./search";
import type { Mark } from "./redact";
import { readSideWidths } from "./sidePanel";
import { clampZoom, type Size, type ZoomMode } from "./zoom";

/** The PDF that's open. */
export interface OpenPdf {
  /** The file's name, e.g. "Report.pdf". */
  fileName: string;
  /** The file as it is now (as opened, plus any changes). */
  bytes: Uint8Array<ArrayBuffer>;
  /** Which opening of a file this is: the same through changes, new for each file opened. */
  openId: number;
  /** pdf.js's reader for it (draws the pages). */
  doc: PDFDocumentProxy;
  /** Each page's size in points, as it shows. */
  sizes: Size[];
  /** The password it was opened with, if it has one. */
  password?: string;
}

export type SidePane = "pages" | "bookmarks" | "notes" | "changes";

export type DialogName = "compress" | "help" | "headers" | "password" | "print" | "sign" | "stamp" | "watermark" | "whatsNew" | null;

/** A version of the PDF to go back or forward to, and what changed it (for "Undo add watermark"). */
export interface Snapshot {
  pdf: OpenPdf;
  label: string;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
}

/** A file waiting for its password. */
export interface PendingPassword {
  file: File;
  wrong: boolean;
}

/** True when the PDF has changes not yet saved to a file. */
export function hasUnsavedChanges(s: { pdf: OpenPdf | null; savedBytes: Uint8Array | null }): boolean {
  return !!s.pdf && s.pdf.bytes !== s.savedBytes;
}

interface State {
  pdf: OpenPdf | null;
  /** Busy opening a file (its name). */
  opening: string | null;
  zoom: ZoomMode;
  /** The zoom as it works out on screen now (set by the page view). */
  shownZoom: number;
  /** The page being read (0 = first). */
  currentPage: number;
  /** A request for the page view to scroll to a page; `n` makes repeat requests for the same page count. */
  goTo: { page: number; n: number } | null;
  sidebar: boolean;
  /** What the side panel shows: the pages, or the bookmarks. */
  sidePane: SidePane;
  /** How wide the side panel is for each pane, in CSS pixels (dragged by its edge). */
  sideWidth: Record<SidePane, number>;
  /** Show one whole page at a time (the wheel and keys flip pages), rather than pages one under another. */
  onePage: boolean;
  dialog: DialogName;
  passwordFor: PendingPassword | null;
  toasts: Toast[];
  theme: "light" | "dark";
  /** The file the PDF was last saved to, if it has been. */
  savedAs: string | null;
  /** The PDF as it was last opened or saved: anything else is unsaved changes. */
  savedBytes: Uint8Array | null;
  /** Versions to go back to (newest last), and forward to after an undo (newest last). */
  past: Snapshot[];
  future: Snapshot[];
  /** Waiting for a click on a page to put words or a picture there. */
  placing: Placing | null;
  /** Reading the words in pictures: how far along (0–1), or null when not. */
  reading: number | null;
  /** Words or a picture on a page, not yet written into the PDF. */
  draft: Draft | null;
  /** Pages picked in the page list (0 = first), and the page a Shift-click run starts from. */
  selected: number[];
  anchor: number | null;
  /** The search bar: what's being looked for and what's been found, or null when it's closed. */
  search: SearchState | null;
  /** Places marked to black out (not yet done), and the one being dragged out. Cleared by every change. */
  marks: Mark[];
  markDraft: Mark | null;
  /** The sticky note open to read or change (a new one has no id), or null. Cleared by every change. */
  note: OpenNote | null;
  /** Trimming pages: the part of a page to keep, dragged out (points from its top-left as shown), or null. */
  trimBox: Mark | null;
  /** A form's signature box being signed (the Sign window is open for it): page, and points from its top-left as shown. */
  signBox: { page: number; x: number; y: number; width: number; height: number } | null;
  /** Comparing with another PDF: its words and the differences found, or null when not comparing. Ends when another file is opened. */
  compare: CompareState | null;

  setNote(note: OpenNote | null): void;
  setCompare(compare: CompareState | null): void;
  setTrimBox(box: Mark | null): void;
  setPdf(pdf: OpenPdf | null): void;
  /** A change to the PDF (labelled for Undo); `pdf` is the new version. */
  changePdf(pdf: OpenPdf, label: string): void;
  undo(): void;
  redo(): void;
  setOpening(name: string | null): void;
  setReading(reading: number | null): void;
  setPlacing(p: Placing | null): void;
  setDraft(d: Draft | null): void;
  setZoom(z: ZoomMode): void;
  setShownZoom(z: number): void;
  setCurrentPage(i: number): void;
  goToPage(i: number): void;
  toggleSidebar(): void;
  setSidePane(p: SidePane): void;
  /** Set the panel's width for a pane; `remember` keeps it on this computer (at the end of a drag). */
  setSideWidth(p: SidePane, width: number, remember?: boolean): void;
  /** One page at a time on or off; it shows the whole page on, and fits the width off. */
  setOnePage(on: boolean): void;
  openDialog(d: DialogName): void;
  askPassword(p: PendingPassword | null): void;
  showToast(text: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
  setTheme(t: "light" | "dark"): void;
  markSaved(name: string): void;
  /** A click on page `i` in the page list (goes to it, and picks pages with Ctrl/⌘ or Shift). */
  pickPage(i: number, kind: ClickKind): void;
  /** Pick exactly these pages (e.g. after they've moved). */
  setSelected(pages: number[]): void;
  /** Open, change or (null) close the search bar. */
  setSearch(search: SearchState | null): void;
  setMarks(marks: Mark[]): void;
  setMarkDraft(mark: Mark | null): void;
}

let toastId = 0;

/** "One page at a time" is remembered on this computer. */
const ONE_PAGE_KEY = "jurapdf.onePage";
/** So is which side panel shows. */
const SIDE_PANE_KEY = "jurapdf.sidePane";
const SIDE_WIDTH_KEY = "jurapdf.sideWidth";
function rememberedWidths(): Record<SidePane, number> {
  try {
    return readSideWidths(globalThis.localStorage?.getItem(SIDE_WIDTH_KEY) ?? null);
  } catch {
    return readSideWidths(null);
  }
}
function rememberedPane(): SidePane {
  try {
    const pane = globalThis.localStorage?.getItem(SIDE_PANE_KEY);
    return pane === "bookmarks" || pane === "notes" ? pane : "pages";
  } catch {
    return "pages";
  }
}
function remembered(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export const useStore = create<State>((set, get) => ({
  pdf: null,
  opening: null,
  zoom: remembered(ONE_PAGE_KEY) ? "page" : "width",
  shownZoom: 1,
  currentPage: 0,
  goTo: null,
  sidebar: true,
  sidePane: rememberedPane(),
  sideWidth: rememberedWidths(),
  onePage: remembered(ONE_PAGE_KEY),
  dialog: null,
  passwordFor: null,
  toasts: [],
  theme: "light",
  savedAs: null,
  savedBytes: null,
  past: [],
  future: [],
  placing: null,
  reading: null,
  draft: null,
  selected: [],
  anchor: null,
  search: null,
  marks: [],
  markDraft: null,
  note: null,
  compare: null,
  trimBox: null,
  signBox: null,

  setNote: (note) => set({ note }),
  setTrimBox: (trimBox) => set({ trimBox }),
  setCompare(compare) {
    // The Changes tab goes with the comparison.
    set(compare || get().sidePane !== "changes" ? { compare } : { compare, sidePane: rememberedPane() });
  },
  setPdf(pdf) {
    const { pdf: old, past, future } = get();
    const keep = new Set(pdf ? [pdf.doc] : []);
    for (const p of [old, ...past.map((s) => s.pdf), ...future.map((s) => s.pdf)]) if (p && !keep.has(p.doc)) void p.doc.destroy();
    set({ pdf, currentPage: 0, goTo: null, zoom: get().onePage ? "page" : "width", savedAs: null, savedBytes: pdf?.bytes ?? null, past: [], future: [], selected: [], anchor: null, marks: [], markDraft: null, note: null, placing: null, draft: null, search: pdf ? get().search : null, compare: null, sidePane: get().sidePane === "changes" ? rememberedPane() : get().sidePane });
  },
  changePdf(pdf, label) {
    const { pdf: old, past, future } = get();
    if (!old) return;
    for (const s of future) void s.pdf.doc.destroy();
    // Keep the last 20 versions to go back to.
    const kept = [...past, { pdf: old, label }];
    for (const s of kept.slice(0, -20)) void s.pdf.doc.destroy();
    set({ pdf, past: kept.slice(-20), future: [], selected: [], anchor: null, marks: [], note: null, currentPage: Math.min(get().currentPage, pdf.sizes.length - 1) });
  },
  undo() {
    const { pdf, past, future } = get();
    const back = past[past.length - 1];
    if (!pdf || !back) return;
    set({ pdf: back.pdf, past: past.slice(0, -1), future: [...future, { pdf, label: back.label }], selected: [], anchor: null, marks: [], note: null, currentPage: Math.min(get().currentPage, back.pdf.sizes.length - 1) });
    get().showToast(`Undone: ${back.label}`);
  },
  redo() {
    const { pdf, past, future } = get();
    const fwd = future[future.length - 1];
    if (!pdf || !fwd) return;
    set({ pdf: fwd.pdf, future: future.slice(0, -1), past: [...past, { pdf, label: fwd.label }], selected: [], anchor: null, marks: [], note: null, currentPage: Math.min(get().currentPage, fwd.pdf.sizes.length - 1) });
    get().showToast(`Redone: ${fwd.label}`);
  },
  setOpening: (opening) => set({ opening }),
  setPlacing: (placing) => set({ placing }),
  setReading: (reading) => set({ reading }),
  setDraft: (draft) => set({ draft }),
  setZoom: (z) => set({ zoom: typeof z === "number" ? clampZoom(z) : z }),
  setShownZoom: (shownZoom) => set({ shownZoom }),
  setCurrentPage(i) {
    if (i !== get().currentPage) set({ currentPage: i });
  },
  goToPage(i) {
    const count = get().pdf?.sizes.length ?? 0;
    if (!count) return;
    const page = Math.min(count - 1, Math.max(0, i));
    set({ goTo: { page, n: (get().goTo?.n ?? 0) + 1 }, currentPage: page });
  },
  toggleSidebar: () => set({ sidebar: !get().sidebar }),
  setSidePane(sidePane) {
    try {
      // The Changes tab only shows while comparing, so it isn't remembered.
      if (sidePane !== "changes") globalThis.localStorage?.setItem(SIDE_PANE_KEY, sidePane);
    } catch {
      // Not remembered; still works now.
    }
    set({ sidePane, sidebar: true });
  },
  setSideWidth(pane, width, remember = false) {
    const sideWidth = { ...get().sideWidth, [pane]: width };
    if (width !== get().sideWidth[pane]) set({ sideWidth });
    if (remember) {
      try {
        globalThis.localStorage?.setItem(SIDE_WIDTH_KEY, JSON.stringify(sideWidth));
      } catch {
        // Not remembered; still works now.
      }
    }
  },
  setOnePage(onePage) {
    if (onePage === get().onePage) return;
    try {
      globalThis.localStorage?.setItem(ONE_PAGE_KEY, onePage ? "1" : "0");
    } catch {
      // Not remembered; still works now.
    }
    set({ onePage, zoom: onePage ? "page" : "width", goTo: get().pdf ? { page: get().currentPage, n: (get().goTo?.n ?? 0) + 1 } : get().goTo });
  },
  openDialog: (dialog) => set({ dialog, signBox: dialog === "sign" ? get().signBox : null }),
  askPassword: (passwordFor) => set({ passwordFor, dialog: passwordFor ? "password" : null }),
  showToast(text, kind = "info") {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-2), { id, text, kind }] });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 9000 : 4500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setTheme: (theme) => set({ theme }),
  markSaved: (savedAs) => set({ savedAs, savedBytes: get().pdf?.bytes ?? null }),
  pickPage(i, kind) {
    const { selected, anchor, currentPage } = get();
    // A plain click just goes to the page (and is where a Shift-click run starts from);
    // Ctrl/⌘-click starts a pick from the page being read.
    if (kind === "only") set({ selected: [], anchor: i });
    else if (kind === "toggle") set({ selected: pickPages(selected.length ? selected : [currentPage], i, "toggle", null), anchor: i });
    else set({ selected: pickPages(selected, i, "run", anchor ?? currentPage), anchor: anchor ?? currentPage });
    get().goToPage(i);
  },
  setSearch: (search) => set({ search }),
  setMarks: (marks) => set({ marks }),
  setMarkDraft: (markDraft) => set({ markDraft }),
  setSelected: (pages) => set({ selected: [...new Set(pages)].sort((a, b) => a - b), anchor: pages.length ? Math.min(...pages) : get().anchor }),
}));
