import { create } from "zustand";

import type { PDFDocumentProxy } from "../pdf/pdfjs";
import { clampZoom, type Size, type ZoomMode } from "./zoom";

/** The PDF that's open. */
export interface OpenPdf {
  /** The file's name, e.g. "Report.pdf". */
  fileName: string;
  /** The file as it was opened. */
  bytes: Uint8Array<ArrayBuffer>;
  /** pdf.js's reader for it (draws the pages). */
  doc: PDFDocumentProxy;
  /** Each page's size in points, as it shows. */
  sizes: Size[];
  /** The password it was opened with, if it has one. */
  password?: string;
}

export type DialogName = "help" | "password" | null;

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

  setPdf(pdf: OpenPdf | null): void;
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

  setPdf(pdf) {
    const old = get().pdf;
    if (old && old.doc !== pdf?.doc) void old.doc.destroy();
    set({ pdf, currentPage: 0, goTo: null, zoom: "width", savedAs: null });
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
  markSaved: (savedAs) => set({ savedAs }),
}));
