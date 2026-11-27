/**
 * Adding words or a picture to a page: choose what, click on a page to put it
 * there, move and size it, then Done writes it into the PDF (one undo step).
 */
import {
  additionLabel,
  BASELINE,
  changeLabel,
  DEFAULT_INK,
  DEFAULT_WORDS,
  highlightsFor,
  keptAt,
  lineAt,
  moveItem,
  thinStroke,
  type AddItem,
  type Kept,
  type Rect,
  type ShapeItem,
  keepOnPage,
  SHAPE_NAMES,
  SHAPE_STYLE,
  sizedShape,
  startingPictureSize,
  FIELD_NAMES,
  FIELD_SIZE,
  fieldBox,
  freshFieldName,
  type FieldKind,
  type Draft,
  type ShapeKind,
} from "../model/additions";
import type { ChosenPicture } from "../model/additions";
import { fontLabel } from "../model/fontCodes";
import { useStore } from "../model/store";
import { nearestFont, type FontChoice } from "../model/watermark";
import { AddProblem, addItems, addShapes, changeItem, pictureType } from "../pdf/additions";
import { keptIn, keptKnown } from "../pdf/items";
import { changePicture, picturesOn } from "../pdf/pictures";
import { screenFontFor, wordRuns } from "../pdf/pdfjs";
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

/** Before starting something new, whatever is being placed or changed is put on the page (if it was changed). */
async function settle(): Promise<void> {
  if (useStore.getState().draft) await finishAdding();
}

/** Get ready to put words on a page (the next click on a page says where). */
export async function startWords(): Promise<void> {
  await settle();
  const s = useStore.getState();
  if (!s.pdf) return;
  dropPicture();
  s.setDraft(null);
  s.setPlacing({ kind: "words" });
  say("Click on a page where the words should start. Esc stops.");
}

/** The last colour, thickness, fill and see-through used for each shape, so the next one matches. */
const lastShape: Record<ShapeKind, { colour: string; thickness: number; fill?: string | null; seeThrough?: number }> = structuredClone(SHAPE_STYLE);

/** Get ready to draw a shape (the next drag on a page draws it). */
export async function startShape(shape: ShapeKind): Promise<void> {
  await settle();
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

/** The kind of form box last added, and the names of the boxes in the PDF's form (for a new one's name). */
let lastField: FieldKind = "text";
let fieldStart: { x: number; y: number } | null = null;

/** Get ready to add a form box (the next drag, or click, on a page puts it there). */
export async function startField(field: FieldKind = lastField): Promise<void> {
  await settle();
  const s = useStore.getState();
  if (!s.pdf) return;
  dropPicture();
  s.setDraft(null);
  s.setPlacing({ kind: "field", field });
  say(`Click on a page where the ${FIELD_NAMES[field].toLowerCase()} should go, or drag out its size. Esc stops.`);
}

/** A press on a page while adding a form box: it's dragged out from here. */
export function startFieldAt(page: number, x: number, y: number): void {
  const s = useStore.getState();
  if (s.placing?.kind !== "field" || !s.pdf) return;
  const field = s.placing.field;
  fieldStart = { x, y };
  // (Names already used, if known: the name is made unique when it's written anyway.)
  const names = (keptKnown(s.pdf.bytes) ?? []).flat().flatMap((k) => (k.item.kind === "field" ? [k.item.name] : []));
  s.setDraft({ kind: "field", field, page, ...fieldBox(field, x, y, x, y), name: freshFieldName(field, names), multiline: false, size: 0, choices: field === "choice" ? ["Yes", "No"] : undefined });
  s.setPlacing(null);
  dropHint();
}

/** The drag that puts a form box on a page went on to here. */
export function fieldDragTo(x: number, y: number): void {
  const d = useStore.getState().draft;
  if (d?.kind !== "field" || !fieldStart) return;
  useStore.getState().setDraft({ ...d, ...fieldBox(d.field, fieldStart.x, fieldStart.y, x, y) });
}

export function endFieldDrag(): void {
  fieldStart = null;
  noteDragEnd();
}

/** Make the form box being placed another kind (a text box, tick box or choice list), keeping it about where it is. */
export function setFieldKind(field: FieldKind): void {
  const d = useStore.getState().draft;
  if (d?.kind !== "field" || d.field === field) return;
  lastField = field;
  const was = FIELD_SIZE[d.field];
  const size = d.width === was.width && d.height === was.height ? FIELD_SIZE[field] : field === "tick" ? { width: Math.min(d.width, d.height), height: Math.min(d.width, d.height) } : { width: Math.max(d.width, 60), height: Math.max(d.height, 16) };
  const fresh = /^(Text|Tick|Choice) \d+$/.test(d.name);
  updateDraft({ field, ...size, name: fresh ? d.name.replace(/^\w+/, { text: "Text", tick: "Tick", choice: "Choice" }[field]) : d.name, choices: field === "choice" ? (d.choices ?? ["Yes", "No"]) : d.choices }, true);
}

/** The last colour, thickness and see-through used for the pen. */
let lastInk = { ...DEFAULT_INK, seeThrough: 0 };

/** Get ready to draw freehand, like a pen: each drag on a page draws a stroke, until Done. */
export async function startInk(): Promise<void> {
  await settle();
  const s = useStore.getState();
  if (!s.pdf) return;
  dropPicture();
  s.setDraft(null);
  s.setPlacing({ kind: "ink" });
  say("Drag on a page to draw. Draw as many strokes as you like, then Done (Enter). Esc stops.");
}

/** A press on a page with the pen: a new stroke starts here (on the drawing being made, if it's on this page). */
export function startStrokeAt(page: number, x: number, y: number): void {
  const s = useStore.getState();
  const d = s.draft;
  if (d && d === settling) {
    // The last drawing is written: this stroke starts a new one.
    s.setDraft({ kind: "ink", page, strokes: [[[x, y]]], colour: lastInk.colour, thickness: lastInk.thickness, seeThrough: lastInk.seeThrough });
  } else if (d?.kind === "ink" && d.page === page) {
    markDraft();
    s.setDraft({ ...d, strokes: [...d.strokes, [[x, y]]] });
  } else {
    if (d?.kind === "ink" && d.strokes.length) void finishInkThenStart(page, x, y);
    else s.setDraft({ kind: "ink", page, strokes: [[[x, y]]], colour: lastInk.colour, thickness: lastInk.thickness, seeThrough: lastInk.seeThrough });
  }
  dropHint();
}

async function finishInkThenStart(page: number, x: number, y: number): Promise<void> {
  await finishAdding(true);
  useStore.getState().setDraft({ kind: "ink", page, strokes: [[[x, y]]], colour: lastInk.colour, thickness: lastInk.thickness, seeThrough: lastInk.seeThrough });
}

/** The pen moved: the stroke being drawn goes on to here. */
export function strokeTo(x: number, y: number): void {
  const s = useStore.getState();
  const d = s.draft;
  if (d?.kind !== "ink" || !d.strokes.length) return;
  const strokes = d.strokes.slice();
  strokes[strokes.length - 1] = [...strokes[strokes.length - 1], [x, y]];
  s.setDraft({ ...d, strokes });
}

/** The pen was lifted: the stroke is tidied (fewer points, same line). */
export function endStroke(): void {
  const s = useStore.getState();
  const d = s.draft;
  if (d?.kind !== "ink" || !d.strokes.length) return;
  const strokes = d.strokes.slice();
  strokes[strokes.length - 1] = thinStroke(strokes[strokes.length - 1]);
  s.setDraft({ ...d, strokes });
  noteDragEnd();
}

/** The drag that draws a shape has ended: a mere click gets a sensible size. */
export function endShapeDrag(): void {
  const d = useStore.getState().draft;
  if (d?.kind === "shape") useStore.getState().setDraft(sizedShape(d));
  noteDragEnd();
}

/** A drag has just ended: the click the browser sends after it isn't a click on the page. */
let dragEnded = false;
export const noteDragEnd = () => (dragEnded = true);
/** True (once) for the click that ends a drag. */
export function justDragged(): boolean {
  const was = dragEnded;
  dragEnded = false;
  return was;
}
// Any fresh press starts afresh.
if (typeof window !== "undefined") window.addEventListener("pointerdown", () => (dragEnded = false), true);

/** Choose a picture, then get ready to put it on a page. */
export async function startPicture(): Promise<void> {
  await settle();
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

/** Get ready to put this picture (a signature) on a page with the next click. */
export async function placePicture(picture: ChosenPicture, hint: string): Promise<void> {
  await settle();
  const s = useStore.getState();
  if (!s.pdf) return;
  dropPicture();
  s.setDraft(null);
  s.setPlacing({ kind: "picture", picture });
  say(hint);
}

/** A click on page `page` at (x, y) points from its top-left: put the words or picture there. */
export function placeAt(page: number, x: number, y: number): void {
  const s = useStore.getState();
  const size = s.pdf?.sizes[page];
  if (!s.placing || !size) return;
  const [pw, ph] = size;
  if (s.placing.kind === "shape" || s.placing.kind === "ink" || s.placing.kind === "field" || s.placing.kind === "redact" || s.placing.kind === "note") return;
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

/**
 * Steps back through the changes made to what's being placed (Ctrl+Z while
 * it's open): each drag, colour or size change is one step.
 */
let draftPast: Draft[] = [];

/** Remember how the draft is now, as a step to go back to. */
export function markDraft(): void {
  const d = useStore.getState().draft;
  if (!d) return;
  if (draftPast[draftPast.length - 1] !== d) draftPast.push(d);
  if (draftPast.length > 100) draftPast.shift();
}

/** Go back a step in what's being placed; false when there's nothing to go back to. */
export function undoDraft(): boolean {
  const s = useStore.getState();
  const back = draftPast.pop();
  if (!back || !s.draft) return false;
  s.setDraft(back);
  return true;
}

/** Change the words or picture being placed. `step`: it counts as a step Ctrl+Z can take back (a drag marks its own start). */
export function updateDraft(change: Partial<Draft>, step = false): void {
  const s = useStore.getState();
  if (!s.draft) return;
  if (step) markDraft();
  const next = { ...s.draft, ...change } as Draft;
  if (next.kind === "words" && !next.cover) lastWords = { font: next.font, size: next.size, colour: next.colour };
  if (next.kind === "shape") lastShape[next.shape] = { colour: next.colour, thickness: next.thickness, fill: next.fill, seeThrough: next.seeThrough };
  if (next.kind === "ink") lastInk = { colour: next.colour, thickness: next.thickness, seeThrough: next.seeThrough ?? 0 };
  s.setDraft(next);
}

/** Stop adding (nothing is written). */
export function cancelAdding(): void {
  const s = useStore.getState();
  dropPicture();
  s.setPlacing(null);
  s.setDraft(null);
  draftPast = [];
  dropHint();
}

/** What a kept addition was when it was opened for changing (to tell whether it changed). */
let opened: { id: number; item: AddItem } | null = null;

/** Open one of JuraPDF's own additions for changing: it shows with its handles and bar, as when it was added. */
async function openKept(k: Kept): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  if (!pdf) return;
  const item = { ...k.item, id: k.id } as AddItem;
  let draft: Draft;
  if (item.kind === "picture") draft = { ...item, preview: previewOf(item.page, k.box) };
  else if (item.kind === "words" && item.own) draft = { ...item, own: { ...item.own, screen: await screenFontFor(pdf.doc, item.page, item.own.base).catch(() => undefined) } };
  else draft = item;
  if (useStore.getState().pdf !== pdf) return;
  opened = { id: k.id, item: draft as AddItem };
  dropPicture();
  s.setPlacing(null);
  s.setDraft(draft);
  draftPast = [];
  dropHint();
}

/**
 * A plain click on a page (no tool on): one of JuraPDF's own additions under
 * it is opened for changing. True when one was.
 */
export async function clickPage(page: number, x: number, y: number): Promise<boolean> {
  const s = useStore.getState();
  if (!s.pdf || s.placing || s.draft) return false;
  const kept = (await keptIn(s.pdf.bytes))[page] ?? [];
  const hit = keptAt(kept, x, y, false);
  if (!hit || useStore.getState().draft || useStore.getState().placing) return false;
  await openKept(hit);
  return true;
}

/** Take what's being changed off the page (or, for something new, just leave it off). */
export async function deleteDraft(): Promise<void> {
  const d = useStore.getState().draft;
  if (!d || d === settling) return;
  if (d.kind === "existing") return deleteExisting();
  if (d.id === undefined) return cancelAdding();
  opened = null;
  await writeKept(d.page, d.id, null, changeLabel(d as AddItem, null));
}

/** Put a copy of what's being changed on the page, a little down and to the right (it stays open to move). */
export async function duplicateDraft(): Promise<void> {
  const d = useStore.getState().draft;
  if (!d || d.kind === "existing" || busy || d === settling) return;
  if (d.kind === "picture" && !d.image) return say("Put the picture on the page first (Done), then it can be copied.");
  await finishAdding();
  const s = useStore.getState();
  if (!s.pdf) return;
  const copy = moveItem({ ...(d as AddItem), id: undefined }, 12, 12);
  busy = true;
  try {
    await applyChange(await addItems(s.pdf.bytes, [copy]), `copy ${changeLabel(d as AddItem, d as AddItem).replace(/^(move|change) /, "")}`);
  } catch (e) {
    problem(e, "copy it");
  } finally {
    busy = false;
  }
  const kept = (await keptIn(useStore.getState().pdf?.bytes ?? new Uint8Array()))[d.page] ?? [];
  const last = kept[kept.length - 1];
  if (last) await openKept(last);
}

/** Put what's being placed (as it was when a drag began, `start`) moved by (dx, dy) points. */
export function moveDraftTo(start: Draft, dx: number, dy: number): void {
  if (start.kind === "existing") updateDraft({ x: start.x + dx, y: start.y + dy });
  else useStore.getState().setDraft(moveItem(start as AddItem, dx, dy) as Draft);
}

/** Nudge what's being placed by (dx, dy) points (arrow keys). */
export function nudgeDraft(dx: number, dy: number): void {
  const d = useStore.getState().draft;
  if (!d) return;
  markDraft();
  if (d.kind === "existing") updateDraft({ x: d.x + dx, y: d.y + dy });
  else useStore.getState().setDraft(moveItem(d as AddItem, dx, dy) as Draft);
}

function problem(e: unknown, what: string): void {
  if (e instanceof AddProblem) say(e.message, "error");
  else if (e instanceof LockedPdf) say("This PDF is locked against changes, so its pages can't be changed.", "error");
  else say(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`, "error");
}

async function writeKept(page: number, id: number, next: AddItem | null, label: string): Promise<void> {
  const s = useStore.getState();
  if (busy || !s.pdf) return;
  busy = true;
  try {
    const old = canvasOf(page);
    const d = s.draft;
    await applyChange(await changeItem(s.pdf.bytes, page, id, next), label);
    await landed(page, old, d);
  } catch (e) {
    problem(e, "change it");
  } finally {
    busy = false;
  }
}

/** What was just written, still showing until the page is drawn again with it. */
let settling: Draft | null = null;

/**
 * It's written: once the page shows it (or soon after), what was placed goes
 * (unless something else is being placed by then). The tool in use stays on.
 */
async function landed(page: number, old: HTMLCanvasElement | null, d: Draft | null): Promise<void> {
  settling = d;
  busy = false;
  await redrawn(page, old);
  if (settling === d) settling = null;
  const s = useStore.getState();
  if (d && s.draft === d) {
    dropPicture();
    s.setDraft(null);
    if (s.placing?.kind !== "ink") s.setPlacing(null);
  }
}

const canvasOf = (page: number) => document.querySelector<HTMLCanvasElement>(`.page[data-page="${page + 1}"] .page-canvas canvas`);

/**
 * Wait (a little) until the page is drawn again after a change, so what was
 * placed doesn't blink off and on. Meanwhile it's done with: Ctrl+Z is the
 * PDF's Undo again.
 */
function redrawn(page: number, old: HTMLCanvasElement | null): Promise<void> {
  draftPast = [];
  const pdf = useStore.getState().pdf;
  return new Promise((resolve) => {
    const until = performance.now() + 1500;
    const look = () => {
      const now = canvasOf(page);
      if (!old || useStore.getState().pdf !== pdf || !document.querySelector(`.page[data-page="${page + 1}"]`) || (now && now !== old) || performance.now() > until) resolve();
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}

/** Get ready to change something already on a page (the next click picks a picture or a line of words). */
export async function startChanging(): Promise<void> {
  await settle();
  const s = useStore.getState();
  if (!s.pdf) return;
  dropPicture();
  s.setDraft(null);
  s.setPlacing({ kind: "change" });
  say("Click on a page on a picture, or on some words, to change it. Esc stops.");
}

/** A click while changing: pick what's under it (JuraPDF's own additions first, then words, then pictures). */
async function pickToChange(page: number, x: number, y: number): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  if (!pdf) return;
  const mine = keptAt((await keptIn(pdf.bytes))[page] ?? [], x, y, true);
  if (useStore.getState().placing?.kind !== "change") return;
  if (mine) {
    await openKept(mine);
    return;
  }
  // Words next (they're usually on top).
  const run = lineAt(await wordRuns(pdf.doc, page), x, y);
  if (useStore.getState().placing?.kind !== "change") return;
  if (run) {
    const family = run.family === "serif" ? "serif" : run.family === "monospace" ? "mono" : "sans";
    const font = nearestFont(family, !!run.font?.bold, !!run.font?.italic);
    const size = Math.round(run.size * 100) / 100;
    const pad = Math.max(1, size * 0.08);
    const cover = { x: run.x - pad, y: run.y - pad, width: run.width + pad * 2, height: run.height + pad * 2 };
    const { ink, paper } = coloursIn(page, { x: run.x, y: run.y, width: run.width, height: run.height });
    s.setDraft({
      kind: "words",
      page,
      x: run.x,
      y: run.baseline - BASELINE[font] * size,
      text: run.text,
      font,
      size,
      colour: ink,
      cover,
      coverColour: paper,
      own: run.font ? { base: run.font.base, label: fontLabel(run.font.base), screen: run.font.screen } : undefined,
    });
    draftPast = [];
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

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/**
 * The colours of words on the page, from its drawing: the paper behind them
 * (the commonest colour in their box) and their ink (the colours furthest
 * from the paper).
 */
function coloursIn(page: number, box: Rect): { ink: string; paper: string } {
  const plain = { ink: "#000000", paper: "#ffffff" };
  const canvas = canvasOf(page);
  const size = useStore.getState().pdf?.sizes[page];
  const ctx = canvas?.getContext("2d");
  if (!canvas || !size || !ctx) return plain;
  const k = canvas.width / size[0];
  const x = Math.max(0, Math.floor(box.x * k));
  const y = Math.max(0, Math.floor(box.y * k));
  const w = Math.min(canvas.width - x, Math.ceil(box.width * k));
  const h = Math.min(canvas.height - y, Math.ceil(box.height * k));
  if (w < 1 || h < 1) return plain;
  let px: Uint8ClampedArray;
  try {
    px = ctx.getImageData(x, y, w, h).data;
  } catch {
    return plain;
  }
  const counts = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const paper = [((top >> 10) & 31) * 8 + 4, ((top >> 5) & 31) * 8 + 4, (top & 31) * 8 + 4];
  const far: { d: number; i: number }[] = [];
  for (let i = 0; i < px.length; i += 4) far.push({ d: Math.abs(px[i] - paper[0]) + Math.abs(px[i + 1] - paper[1]) + Math.abs(px[i + 2] - paper[2]), i });
  far.sort((a, b) => b.d - a.d);
  const most = far.slice(0, Math.max(1, Math.floor(far.length * 0.05)));
  if (most[0].d < 60) return { ink: plain.ink, paper: hex(paper[0], paper[1], paper[2]) };
  const sum = most.reduce((t, { i }) => [t[0] + px[i], t[1] + px[i + 1], t[2] + px[i + 2]], [0, 0, 0]);
  // Near-white paper is taken to be white (the drawing's edges blur it a little).
  const white = paper.every((v) => v > 236);
  return { ink: hex(sum[0] / most.length, sum[1] / most.length, sum[2] / most.length), paper: white ? "#ffffff" : hex(paper[0], paper[1], paper[2]) };
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
    const old = canvasOf(page);
    const d = s.draft;
    await applyChange(await changePicture(s.pdf.bytes, page, n, change), label);
    await landed(page, old, d);
  } catch (e) {
    problem(e, "change the picture");
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

/** How picked words are marked: coloured in, a line under them, or a line through them. */
export type WordMark = "highlight" | "underline" | "crossout";

const MARK_VERB: Record<WordMark, string> = { highlight: "highlight", underline: "underline", crossout: "cross out" };

/** Lines under (or through) picked words: one per line of them, about as thick as the letters are heavy. */
function linesFor(page: number, rects: Rect[], mark: "underline" | "crossout", colour: string): ShapeItem[] {
  return highlightsFor(page, rects, colour).map((h) => {
    const height = h.y2 - h.y1;
    const thickness = Math.max(0.6, Math.round(height * 0.07 * 10) / 10);
    const y = mark === "underline" ? h.y2 - height * 0.12 : h.y1 + height * 0.55;
    return { kind: "shape", shape: "line", page, x1: h.x1, y1: y, x2: h.x2, y2: y, colour, thickness };
  });
}

/** Mark the words picked with the mouse (one undo step, however many lines and pages). */
export async function highlightPicked(mark: WordMark = "highlight"): Promise<void> {
  const s = useStore.getState();
  if (busy || !s.pdf) return;
  const items: ShapeItem[] = [];
  for (const [page, rects] of pickedWordBoxes()) {
    items.push(...(mark === "highlight" ? highlightsFor(page, rects, lastShape.highlight.colour) : linesFor(page, rects, mark, mark === "underline" ? "#1f5fbf" : "#d1373a")));
  }
  if (!items.length) return;
  const pages = [...new Set(items.map((i) => i.page + 1))];
  busy = true;
  try {
    const bytes = await addShapes(s.pdf.bytes, items);
    await applyChange(bytes, pages.length === 1 ? `${MARK_VERB[mark]} words on page ${pages[0]}` : `${MARK_VERB[mark]} words on pages ${pages[0]}–${pages[pages.length - 1]}`);
    window.getSelection()?.removeAllRanges();
  } catch (e) {
    if (e instanceof LockedPdf) say("This PDF is locked against changes, so nothing can be highlighted.", "error");
    else say(`Couldn't highlight them: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    busy = false;
  }
}

/** Write the words or picture into the PDF. `keepTool`: the pen stays ready for more (it's moving to another page). */
export async function finishAdding(keepTool = false): Promise<void> {
  const s = useStore.getState();
  const draft = s.draft;
  if (busy || !draft || !s.pdf || draft === settling) return;
  if ((draft.kind === "words" && !draft.text.trim() && !draft.cover && draft.id === undefined) || (draft.kind === "ink" && !draft.strokes.some((st) => st.length))) {
    cancelAdding();
    return;
  }
  if (draft.kind !== "existing" && draft.id !== undefined) {
    const was = opened?.id === draft.id ? opened.item : null;
    const now = { ...draft, preview: undefined } as unknown as AddItem;
    if (was && JSON.stringify({ ...was, preview: undefined }) === JSON.stringify(now)) cancelAdding();
    else if (draft.kind === "words" && !draft.text.trim() && !draft.cover) await writeKept(draft.page, draft.id, null, changeLabel(now, null));
    else await writeKept(draft.page, draft.id, now, changeLabel(was ?? now, now));
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
    const old = canvasOf(draft.page);
    const bytes =
      draft.kind === "picture"
        ? await addItems(s.pdf.bytes, [{ kind: "picture", page: draft.page, x: draft.x, y: draft.y, width: draft.width, height: draft.height, signature: draft.picture?.name === "Signature" || undefined, stamp: draft.picture?.stamp }], draft.picture)
        : await addItems(s.pdf.bytes, [draft]);
    await applyChange(bytes, additionLabel(draft.kind === "picture" ? { ...draft, signature: draft.picture?.name === "Signature" || undefined, stamp: draft.picture?.stamp } : draft));
    if (keepTool) useStore.getState().setPlacing({ kind: "ink" });
    await landed(draft.page, old, draft);
  } catch (e) {
    problem(e, "add it");
  } finally {
    busy = false;
  }
}

/** Let go of a chosen picture that's no longer needed. */
function dropPicture(): void {
  const s = useStore.getState();
  const urls = [s.placing?.kind === "picture" ? s.placing.picture.url : null, s.draft?.kind === "picture" ? (s.draft.picture?.url ?? null) : null];
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

