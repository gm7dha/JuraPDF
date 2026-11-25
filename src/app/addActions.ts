/**
 * Adding words or a picture to a page: choose what, click on a page to put it
 * there, move and size it, then Done writes it into the PDF (one undo step).
 */
import { additionLabel, DEFAULT_WORDS, keepOnPage, SHAPE_NAMES, SHAPE_STYLE, sizedShape, startingPictureSize, type Draft, type ShapeKind } from "../model/additions";
import { useStore } from "../model/store";
import type { FontChoice } from "../model/watermark";
import { AddProblem, addPicture, addShape, addWords, pictureType } from "../pdf/additions";
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

let busy = false;

/** Write the words or picture into the PDF. */
export async function finishAdding(): Promise<void> {
  const s = useStore.getState();
  const draft = s.draft;
  if (busy || !draft || !s.pdf) return;
  if (draft.kind === "words" && !draft.text.trim()) {
    cancelAdding();
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

