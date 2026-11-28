/**
 * Blacking out (redaction): marking places (drag on a page, picked words, or
 * everything Find words found), then blacking them all out for good as one
 * step in Undo.
 */
import { lettersBox, markFrom, marksByPage, marksLabel, wordsOutside, type Mark } from "../model/redact";
import { useStore } from "../model/store";
import { pageBlackedOut, pageTextBoxes } from "../pdf/pdfjs";
import { blackOut, RedactProblem, type BlackedOutPage } from "../pdf/redact";
import { LockedPdf } from "../pdf/watermark";
import { pickedWordBoxes } from "./addActions";
import { applyChange } from "./editing";

const say = (text: string, kind: "info" | "error" | "success" = "info") => useStore.getState().showToast(text, kind);

/** How finely blacked-out pages are redrawn: 200 dots to the inch, sharp in print. */
const DPI = 200;

/** The black-out tool: drag over what to hide (Esc or the button again to stop). */
export function startMarking(): void {
  const s = useStore.getState();
  if (!s.pdf) return;
  s.setDraft(null);
  s.setPlacing({ kind: "redact" });
  window.getSelection()?.removeAllRanges();
  if (!s.marks.length) say("Drag over what to black out. Nothing is blacked out until you click “Black out for good”.", "info");
}

export function stopMarking(): void {
  const s = useStore.getState();
  if (s.placing?.kind === "redact") s.setPlacing(null);
  s.setMarkDraft(null);
}

let from: { page: number; x: number; y: number } | null = null;

export function startMarkAt(page: number, x: number, y: number): void {
  from = { page, x, y };
  useStore.getState().setMarkDraft(null);
}

export function markDragTo(x: number, y: number): void {
  const s = useStore.getState();
  const size = s.pdf?.sizes[from?.page ?? -1];
  if (!from || !size) return;
  s.setMarkDraft(markFrom(from.page, from.x, from.y, x, y, size[0], size[1]));
}

export function endMarkDrag(): void {
  const s = useStore.getState();
  const m = s.markDraft;
  from = null;
  s.setMarkDraft(null);
  if (m) s.setMarks([...s.marks, m]);
}

export function removeMark(i: number): void {
  const s = useStore.getState();
  s.setMarks(s.marks.filter((_, k) => k !== i));
}

export function clearMarks(): void {
  useStore.getState().setMarks([]);
  stopMarking();
}

/** Mark the words picked with the mouse. */
export function markPicked(): void {
  const s = useStore.getState();
  const added: Mark[] = [];
  for (const [page, rects] of pickedWordBoxes()) for (const r of rects) added.push({ page, x: r.x - 1, y: r.y - 1, width: r.width + 2, height: r.height + 2 });
  if (!added.length) return;
  s.setMarks([...s.marks, ...added]);
  window.getSelection()?.removeAllRanges();
  say(`Marked ${marksLabel(added)} to black out. Click “Black out for good” when everything's marked.`, "info");
}

/** Mark every place Find words found. */
export async function markFound(): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  const hits = s.search?.hits ?? [];
  if (!pdf || !hits.length) return;
  const added: Mark[] = [];
  const boxes = new Map<number, Awaited<ReturnType<typeof pageTextBoxes>>>();
  for (const hit of hits) {
    if (!boxes.has(hit.page)) boxes.set(hit.page, await pageTextBoxes(pdf.doc, hit.page));
    const bits = boxes.get(hit.page)!;
    for (const piece of hit.pieces) {
      const bit = bits[piece.bit];
      if (bit) added.push(lettersBox(bit, piece.from, piece.to, hit.page));
    }
  }
  if (useStore.getState().pdf !== pdf) return;
  useStore.getState().setMarks([...useStore.getState().marks, ...added]);
  say(`Marked all ${hits.length} found to black out (${marksLabel(added).replace(/^\d+ places? /, "")}). Check them, then click “Black out for good”.`, "info");
}

let busy = false;

/** Black out everything marked, for good (one step in Undo). */
export async function blackOutMarked(): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  if (busy || !pdf || !s.marks.length) return;
  busy = true;
  const marks = s.marks;
  try {
    const pages: BlackedOutPage[] = [];
    for (const [page, onPage] of marksByPage(marks)) {
      const bits = (await pageTextBoxes(pdf.doc, page)).filter((b) => b.usable);
      pages.push({ page, marks: onPage, picture: await pageBlackedOut(pdf.doc, page, DPI, onPage), words: wordsOutside(bits, onPage) });
    }
    const bytes = await blackOut(pdf.bytes, pages);
    if (useStore.getState().pdf !== pdf) return;
    stopMarking();
    for (const t of useStore.getState().toasts) if (t.text.startsWith("Drag over what to black out")) useStore.getState().dismissToast(t.id);
    await applyChange(bytes, `black out ${marksLabel(marks)}`);
    say(
      `Blacked out ${marksLabel(marks)}. What was under the black is gone from ${pages.length === 1 ? "that page" : "those pages"} (Save to keep it that way). ${pages.length === 1 ? "That page is" : "Those pages are"} now a picture, but its other words can still be picked and found.`,
      "success",
    );
  } catch (e) {
    say(e instanceof RedactProblem || e instanceof LockedPdf ? e.message : `Couldn't black it out: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    busy = false;
  }
}
