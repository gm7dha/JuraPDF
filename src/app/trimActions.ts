/**
 * Trimming pages (cropping): drag a box round the part of a page to keep, then
 * trim that page, all of them or the picked ones by the same margins. Nothing
 * is thrown away: "Show whole pages" brings the edges back. One step in Undo.
 */
import { pagesLabel } from "../model/pages";
import { markFrom } from "../model/redact";
import { useStore } from "../model/store";
import { marginsFor, marginsLabel, trims } from "../model/trim";
import { PageProblem, trimPages, untrimPages } from "../pdf/pages";
import { LockedPdf } from "../pdf/watermark";
import { applyChange } from "./editing";

const say = (text: string, kind: "info" | "error" | "success" = "info") => useStore.getState().showToast(text, kind);

/** Which pages a trim is for. */
export type TrimWhich = "this" | "all" | "picked";

export function startTrimming(): void {
  const s = useStore.getState();
  if (!s.pdf) return;
  s.setDraft(null);
  s.setPlacing({ kind: "trim" });
  window.getSelection()?.removeAllRanges();
  say("Drag a box round the part of the page to keep. The edges outside it are trimmed off (they can be brought back).", "info");
}

export function stopTrimming(): void {
  const s = useStore.getState();
  if (s.placing?.kind === "trim") s.setPlacing(null);
  s.setTrimBox(null);
}

let from: { page: number; x: number; y: number } | null = null;

export function startTrimAt(page: number, x: number, y: number): void {
  from = { page, x, y };
}

export function trimDragTo(x: number, y: number): void {
  const s = useStore.getState();
  const size = s.pdf?.sizes[from?.page ?? -1];
  if (!from || !size) return;
  const box = markFrom(from.page, from.x, from.y, x, y, size[0], size[1]);
  if (box) s.setTrimBox(box);
}

export function endTrimDrag(): void {
  from = null;
}

/** The pages for a choice, counted from 0. */
export function pagesFor(which: TrimWhich): number[] {
  const s = useStore.getState();
  const count = s.pdf?.sizes.length ?? 0;
  if (which === "all") return Array.from({ length: count }, (_, i) => i);
  if (which === "picked" && s.selected.length) return s.selected;
  return s.trimBox ? [s.trimBox.page] : [s.currentPage];
}


let busy = false;

/** Trim the chosen pages by the margins of the box dragged out. */
export async function trimChosen(which: TrimWhich): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  const box = s.trimBox;
  if (busy || !pdf || !box) return;
  const [w, h] = pdf.sizes[box.page];
  const margins = marginsFor(box, w, h);
  if (!trims(margins)) {
    say("That box is the whole page, so there's nothing to trim.", "info");
    return;
  }
  busy = true;
  try {
    const pages = pagesFor(which);
    const out = await trimPages(pdf.bytes, pages, margins);
    if (useStore.getState().pdf !== pdf) return;
    if (!out.trimmed.length) {
      say(`Trimming ${marginsLabel(margins)} would leave too little of ${pages.length === 1 ? "the page" : "these pages"}, so nothing was trimmed.`, "error");
      return;
    }
    stopTrimming();
    for (const t of useStore.getState().toasts) if (t.text.startsWith("Drag a box round")) useStore.getState().dismissToast(t.id);
    await applyChange(out.bytes, `trim ${pagesLabel(out.trimmed)}`);
    const skipped = out.skipped.length ? ` ${out.skipped.length === 1 ? "Page" : "Pages"} ${out.skipped.map((p) => p + 1).join(", ")} ${out.skipped.length === 1 ? "is" : "are"} too small, so left as ${out.skipped.length === 1 ? "it was" : "they were"}.` : "";
    say(`Trimmed ${pagesLabel(out.trimmed)}: ${marginsLabel(margins)}.${skipped} Nothing's thrown away: “Show whole pages” in the Trim tool (C) brings the edges back.`, "success");
  } catch (e) {
    say(e instanceof LockedPdf || e instanceof PageProblem ? e.message : `Couldn't trim: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    busy = false;
  }
}

/** Show the whole of the chosen pages again. */
export async function untrimChosen(which: TrimWhich): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  if (busy || !pdf) return;
  busy = true;
  try {
    const out = await untrimPages(pdf.bytes, pagesFor(which));
    if (useStore.getState().pdf !== pdf) return;
    if (!out.untrimmed.length) {
      say(which === "this" ? "This page isn't trimmed: it already shows all of its paper." : "None of these pages is trimmed.", "info");
      return;
    }
    stopTrimming();
    await applyChange(out.bytes, `untrim ${pagesLabel(out.untrimmed)}`);
    say(`${pagesLabel(out.untrimmed).replace(/^p/, "P")} ${out.untrimmed.length === 1 ? "shows" : "show"} all of the paper again.`, "success");
  } catch (e) {
    say(e instanceof LockedPdf || e instanceof PageProblem ? e.message : `Couldn't do it: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    busy = false;
  }
}

// The box goes when the tool is put down, or the PDF changes under it.
useStore.subscribe((s, prev) => {
  if (s.trimBox && (s.placing?.kind !== "trim" || s.pdf?.doc !== prev.pdf?.doc)) s.setTrimBox(null);
});
