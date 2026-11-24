import { create } from "zustand";

import type { PDFDocumentProxy } from "../pdf/pdfjs";
import { pickPages, type ClickKind } from "./pages";
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

export type DialogName = "help" | "password" | "print" | "watermark" | null;

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
  /** Pages picked in the page list (0 = first), and the page a Shift-click run starts from. */
  selected: number[];
  anchor: number | null;

  setPdf(pdf: OpenPdf | null): void;
  /** A change to the PDF (labelled for Undo); `pdf` is the new version. */
  changePdf(pdf: OpenPdf, label: string): void;
  undo(): void;
  redo(): void;
  setOpening(name: string | null): void;
  setZoom(z: ZoomMode): void;
  setShownZoom(z: number): void;
  setCurrentPage(i: number): void;
  goToPage(i: number): void;
  toggleSidebar(): void;
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
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  pdf: null,
  opening: null,
  zoom: "width",
  shownZoom: 1,
  currentPage: 0,
  goTo: null,
  sidebar: true,
  dialog: null,
  passwordFor: null,
  toasts: [],
  theme: "light",
  savedAs: null,
  savedBytes: null,
  past: [],
  future: [],
  selected: [],
  anchor: null,

  setPdf(pdf) {
    const { pdf: old, past, future } = get();
    const keep = new Set(pdf ? [pdf.doc] : []);
    for (const p of [old, ...past.map((s) => s.pdf), ...future.map((s) => s.pdf)]) if (p && !keep.has(p.doc)) void p.doc.destroy();
    set({ pdf, currentPage: 0, goTo: null, zoom: "width", savedAs: null, savedBytes: pdf?.bytes ?? null, past: [], future: [], selected: [], anchor: null });
  },
  changePdf(pdf, label) {
    const { pdf: old, past, future } = get();
    if (!old) return;
    for (const s of future) void s.pdf.doc.destroy();
    // Keep the last 20 versions to go back to.
    const kept = [...past, { pdf: old, label }];
    for (const s of kept.slice(0, -20)) void s.pdf.doc.destroy();
    set({ pdf, past: kept.slice(-20), future: [], selected: [], anchor: null, currentPage: Math.min(get().currentPage, pdf.sizes.length - 1) });
  },
  undo() {
    const { pdf, past, future } = get();
    const back = past[past.length - 1];
    if (!pdf || !back) return;
    set({ pdf: back.pdf, past: past.slice(0, -1), future: [...future, { pdf, label: back.label }], selected: [], anchor: null, currentPage: Math.min(get().currentPage, back.pdf.sizes.length - 1) });
    get().showToast(`Undone: ${back.label}`);
  },
  redo() {
    const { pdf, past, future } = get();
    const fwd = future[future.length - 1];
    if (!pdf || !fwd) return;
    set({ pdf: fwd.pdf, future: future.slice(0, -1), past: [...past, { pdf, label: fwd.label }], selected: [], anchor: null, currentPage: Math.min(get().currentPage, fwd.pdf.sizes.length - 1) });
    get().showToast(`Redone: ${fwd.label}`);
  },
  setOpening: (opening) => set({ opening }),
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
  openDialog: (dialog) => set({ dialog }),
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
  setSelected: (pages) => set({ selected: [...new Set(pages)].sort((a, b) => a - b), anchor: pages.length ? Math.min(...pages) : get().anchor }),
}));
