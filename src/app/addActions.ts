/**
 * Adding words or a picture to a page: choose what, click on a page to put it
 * there, move and size it, then Done writes it into the PDF (one undo step).
 */
import { additionLabel, BASELINE, DEFAULT_WORDS, highlightsFor, lineAt, type Rect, type ShapeItem, keepOnPage, SHAPE_NAMES, SHAPE_STYLE, sizedShape, startingPictureSize, type Draft, type ShapeKind } from "../model/additions";
import { useStore } from "../model/store";
import type { FontChoice } from "../model/watermark";
import { AddProblem, addPicture, addShape, addShapes, addWords, pictureType } from "../pdf/additions";
import { changePicture, picturesOn } from "../pdf/pictures";
import { wordRuns } from "../pdf/pdfjs";
import { LockedPdf } from "../pdf/watermark";
import { applyChange } from "./editing";

/** The last font, size and colour used, so the next words match. */
let lastWords: { font: FontChoice; size: number; colour: string } = { ...DEFAULT_WORDS };

const say = (text: string, kind: "info" | "error" = "info") => useStore.getState().showToast(text, kind);

/** Take away the "Click on a page…" hint once it's done its job. */
function dropHint(): void {
  const s = useStore.getState();
  for (const t of s.toasts) if (t.text.startsWith("Click on a page")) s.dismissToast(t.id);
}

/** Get ready to put words on a page (the next click on a page says where). */
export function startWords(): void {
  const s = useStore.getState();
  if (!s.pdf) return;
  dropPicture();
  s.setDraft(null);
  s.setPlacing({ kind: "words" });
  say("Click on a page where the words should start. Esc stops.");
}

/** The last colour and thickness used for each shape, so the next one matches. */
const lastShape: Record<ShapeKind, { colour: string; thickness: number }> = structuredClone(SHAPE_STYLE);

/** Get ready to draw a shape (the next drag on a page draws it). */
export function startShape(shape: ShapeKind): void {
  const s = useStore.getState();
  if (!s.pdf) return;
  dropPicture();
  s.setDraft(null);
  s.setPlacing({ kind: "shape", shape });
  say(
    shape === "highlight"
      ? "Click on a page and drag across the words to highlight them. Esc stops."
      : `Click on a page and drag to draw the ${SHAPE_NAMES[shape].toLowerCase()}. Esc stops.`,
  );
}

/** A press on a page while drawing a shape: it runs from here to wherever the pointer goes. */
export function startShapeAt(page: number, x: number, y: number): void {
  const s = useStore.getState();
  if (s.placing?.kind !== "shape") return;
  const shape = s.placing.shape;
  s.setDraft({ kind: "shape", shape, page, x1: x, y1: y, x2: x, y2: y, ...lastShape[shape] });
  s.setPlacing(null);
  dropHint();
}

/** The drag that draws a shape has ended: a mere click gets a sensible size. */
export function endShapeDrag(): void {
  const d = useStore.getState().draft;
  if (d?.kind === "shape") useStore.getState().setDraft(sizedShape(d));
}

/** Choose a picture, then get ready to put it on a page. */
export async function startPicture(): Promise<void> {
  if (!useStore.getState().pdf) return;
  const file = await pickPicture();
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = pictureType(bytes);
  if (!type) {
    say(`${file.name} isn't a PNG or JPG picture, so it can't be put on a page.`, "error");
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: type === "png" ? "image/png" : "image/jpeg" }));
  let size: { w: number; h: number };
  try {
    size = await pixelSize(url);
  } catch {
    URL.revokeObjectURL(url);
    say(`${file.name} couldn't be read as a picture.`, "error");
    return;
  }
  const s = useStore.getState();
  dropPicture();
  s.setDraft(null);
  s.setPlacing({ kind: "picture", picture: { bytes, type, name: file.name, url, pixelsWide: size.w, pixelsHigh: size.h } });
  say("Click on a page where the picture should go. Esc stops.");
}

/** A click on page `page` at (x, y) points from its top-left: put the words or picture there. */
export function placeAt(page: number, x: number, y: number): void {
  const s = useStore.getState();
  const size = s.pdf?.sizes[page];
  if (!s.placing || !size) return;
  const [pw, ph] = size;
  if (s.placing.kind === "shape") return;
  if (s.placing.kind === "change") {
    void pickToChange(page, x, y);
    return;
  }
  if (s.placing.kind === "words") {
    const at = keepOnPage(x, y - lastWords.size * 0.6, lastWords.size * 4, lastWords.size * 1.2, pw, ph);
    s.setDraft({ kind: "words", page, x: at.x, y: at.y, text: "", ...lastWords });
  } else {
    const { picture } = s.placing;
    const { width, height } = startingPictureSize(picture.pixelsWide, picture.pixelsHigh, pw, ph);
    const at = keepOnPage(x - width / 2, y - height / 2, width, height, pw, ph, Math.min(width, height));
    s.setDraft({ kind: "picture", page, x: at.x, y: at.y, width, height, picture });
  }
  s.setPlacing(null);
  dropHint();
}

/** Change the words or picture being placed. */
export function updateDraft(change: Partial<Draft>): void {
  const s = useStore.getState();
  if (!s.draft) return;
  const next = { ...s.draft, ...change } as Draft;
  if (next.kind === "words") lastWords = { font: next.font, size: next.size, colour: next.colour };
  if (next.kind === "shape") lastShape[next.shape] = { colour: next.colour, thickness: next.thickness };
  s.setDraft(next);
}

/** Stop adding (nothing is written). */
export function cancelAdding(): void {
  const s = useStore.getState();
  dropPicture();
  s.setPlacing(null);
  s.setDraft(null);
  dropHint();
}

/** Get ready to change something already on a page (the next click picks a picture or a line of words). */
export function startChanging(): void {
  const s = useStore.getState();
  if (!s.pdf) return;
  dropPicture();
  s.setDraft(null);
  s.setPlacing({ kind: "change" });
  say("Click on a page on a picture, or on some words, to change it. Esc stops.");
}

const FAMILY_FONT: Record<string, FontChoice> = { serif: "TimesRoman", monospace: "Courier" };

/** A click while changing: pick the words or the picture under it. */
async function pickToChange(page: number, x: number, y: number): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  if (!pdf) return;
  // Words first (they're usually on top).
  const run = lineAt(await wordRuns(pdf.doc, page), x, y);
  if (useStore.getState().placing?.kind !== "change") return;
  if (run) {
    const font = FAMILY_FONT[run.family] ?? "Helvetica";
    const size = Math.round(run.size * 10) / 10;
    const pad = Math.max(1, size * 0.08);
    s.setDraft({
      kind: "words",
      page,
      x: run.x,
      y: run.baseline - BASELINE[font] * size,
      text: run.text,
      font,
      size,
      colour: "#000000",
      cover: { x: run.x - pad, y: run.y - pad, width: run.width + pad * 2, height: run.height + pad * 2 },
    });
    s.setPlacing(null);
    dropHint();
    return;
  }
  const spots = await picturesOn(pdf.bytes, page);
  const hit = lineAt(spots.map((p) => ({ ...p.box, spot: p })), x, y)?.spot;
  if (useStore.getState().placing?.kind !== "change") return;
  if (!hit) {
    say("There's no picture or words just there to change. Click right on one, or press Esc to stop.");
    return;
  }
  const { box } = hit;
  s.setDraft({ kind: "existing", page, n: hit.n, x: box.x, y: box.y, width: box.width, height: box.height, from: box, preview: previewOf(page, box) });
  s.setPlacing(null);
  dropHint();
}

/** How the picture looks now, copied from the page's drawing, to show while it's moved. */
function previewOf(page: number, box: Rect): string {
  const canvas = document.querySelector<HTMLCanvasElement>(`.page[data-page="${page + 1}"] canvas`);
  const size = useStore.getState().pdf?.sizes[page];
  if (!canvas || !size) return "";
  const k = canvas.width / size[0];
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(box.width * k));
  out.height = Math.max(1, Math.round(box.height * k));
  out.getContext("2d")?.drawImage(canvas, box.x * k, box.y * k, box.width * k, box.height * k, 0, 0, out.width, out.height);
  return out.toDataURL();
}

/** Take the picture being changed off the page. */
export async function deleteExisting(): Promise<void> {
  const d = useStore.getState().draft;
  if (d?.kind !== "existing") return;
  await changeExisting(d.page, d.n, { kind: "remove" }, `delete a picture on page ${d.page + 1}`);
}

/** Swap the picture being changed for another one, in the same place. */
export async function replaceExisting(): Promise<void> {
  const d = useStore.getState().draft;
  if (d?.kind !== "existing") return;
  const file = await pickPicture();
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = pictureType(bytes);
  if (!type) {
    say(`${file.name} isn't a PNG or JPG picture, so it can't go on a page.`, "error");
    return;
  }
  await changeExisting(d.page, d.n, { kind: "replace", picture: { bytes, type, name: file.name }, to: { x: d.x, y: d.y, width: d.width, height: d.height } }, `replace a picture on page ${d.page + 1}`);
}

async function changeExisting(page: number, n: number, change: Parameters<typeof changePicture>[3], label: string): Promise<void> {
  const s = useStore.getState();
  if (busy || !s.pdf) return;
  busy = true;
  try {
    await applyChange(await changePicture(s.pdf.bytes, page, n, change), label);
    cancelAdding();
  } catch (e) {
    if (e instanceof AddProblem) say(e.message, "error");
    else if (e instanceof LockedPdf) say("This PDF is locked against changes, so its pictures can't be changed.", "error");
    else say(`Couldn't change the picture: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    busy = false;
  }
}

let busy = false;

/** The boxes (in points, per page) of the words picked with the mouse, from the pages' words layers. */
export function pickedWordBoxes(): Map<number, Rect[]> {
  const out = new Map<number, Rect[]>();
  const sel = window.getSelection();
  const sizes = useStore.getState().pdf?.sizes;
  if (!sel || sel.isCollapsed || !sel.rangeCount || !sizes) return out;
  const range = sel.getRangeAt(0);
  for (const pageEl of document.querySelectorAll<HTMLElement>(".page[data-page]")) {
    const layer = pageEl.querySelector(".textLayer");
    const index = Number(pageEl.dataset.page) - 1;
    const size = sizes[index];
    if (!layer || !size || !range.intersectsNode(layer)) continue;
    const box = pageEl.getBoundingClientRect();
    const scale = box.width / size[0];
    const rects: Rect[] = [];
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node) || !node.textContent?.trim()) continue;
      const part = document.createRange();
      part.selectNodeContents(node);
      if (node === range.startContainer) part.setStart(node, range.startOffset);
      if (node === range.endContainer) part.setEnd(node, range.endOffset);
      for (const r of part.getClientRects()) {
        rects.push({ x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, width: r.width / scale, height: r.height / scale });
      }
    }
    if (rects.length) out.set(index, rects);
  }
  return out;
}

/** Highlight the words picked with the mouse (one undo step, however many lines and pages). */
export async function highlightPicked(): Promise<void> {
  const s = useStore.getState();
  if (busy || !s.pdf) return;
  const items: ShapeItem[] = [];
  for (const [page, rects] of pickedWordBoxes()) items.push(...highlightsFor(page, rects, lastShape.highlight.colour));
  if (!items.length) return;
  const pages = [...new Set(items.map((i) => i.page + 1))];
  busy = true;
  try {
    const bytes = await addShapes(s.pdf.bytes, items);
    await applyChange(bytes, pages.length === 1 ? `highlight words on page ${pages[0]}` : `highlight words on pages ${pages[0]}–${pages[pages.length - 1]}`);
    window.getSelection()?.removeAllRanges();
  } catch (e) {
    if (e instanceof LockedPdf) say("This PDF is locked against changes, so nothing can be highlighted.", "error");
    else say(`Couldn't highlight them: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    busy = false;
  }
}

/** Write the words or picture into the PDF. */
export async function finishAdding(): Promise<void> {
  const s = useStore.getState();
  const draft = s.draft;
  if (busy || !draft || !s.pdf) return;
  if (draft.kind === "words" && !draft.text.trim() && !draft.cover) {
    cancelAdding();
    return;
  }
  if (draft.kind === "existing") {
    const f = draft.from;
    if (Math.abs(draft.x - f.x) + Math.abs(draft.y - f.y) + Math.abs(draft.width - f.width) + Math.abs(draft.height - f.height) < 0.05) cancelAdding();
    else await changeExisting(draft.page, draft.n, { kind: "move", to: { x: draft.x, y: draft.y, width: draft.width, height: draft.height } }, `move a picture on page ${draft.page + 1}`);
    return;
  }
  busy = true;
  try {
    const bytes =
      draft.kind === "words"
        ? await addWords(s.pdf.bytes, draft)
        : draft.kind === "shape"
          ? await addShape(s.pdf.bytes, draft)
          : await addPicture(s.pdf.bytes, { kind: "picture", page: draft.page, x: draft.x, y: draft.y, width: draft.width, height: draft.height }, draft.picture);
    await applyChange(bytes, additionLabel(draft));
    cancelAdding();
  } catch (e) {
    if (e instanceof AddProblem) say(e.message, "error");
    else if (e instanceof LockedPdf) say("This PDF is locked against changes, so nothing can be added to its pages.", "error");
    else say(`Couldn't add it: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    busy = false;
  }
}

/** Let go of a chosen picture that's no longer needed. */
function dropPicture(): void {
  const s = useStore.getState();
  const urls = [s.placing?.kind === "picture" ? s.placing.picture.url : null, s.draft?.kind === "picture" ? s.draft.picture.url : null];
  for (const url of urls) if (url) URL.revokeObjectURL(url);
}

function pixelSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("unreadable"));
    img.src = url;
  });
}

function pickPicture(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".png,.jpg,.jpeg,image/png,image/jpeg";
    input.className = "file-input";
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    };
    input.oncancel = () => {
      input.remove();
      resolve(null);
    };
    document.body.append(input);
    input.click();
  });
}

