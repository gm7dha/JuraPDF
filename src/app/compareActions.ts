/**
 * Comparing the open PDF with another one by their words: pick the other file,
 * read both files' words, list the differences in the side panel's Changes tab
 * and colour them in on the pages (`CompareLayer`). "Mark them on this PDF"
 * writes them in for good: new words highlighted green, a sticky note where
 * words were taken out or changed (one step in Undo). Worked out again by
 * itself after every change to the open PDF.
 */
import { highlightsFor, type ShapeItem } from "../model/additions";
import { changesBetween, compareSummary, noteFor, wordsIn, type Change, type CompareState, type PlaceBox, type WordAt } from "../model/compare";
import { NOTE_SIZE, notePlace } from "../model/notes";
import type { TextBox } from "../model/redact";
import { useStore } from "../model/store";
import { addShapes } from "../pdf/additions";
import { addNotes, type NewNote } from "../pdf/notes";
import { loadPdf, NeedsPassword, pageTextBoxes, type PDFDocumentProxy } from "../pdf/pdfjs";
import { LockedPdf } from "../pdf/watermark";
import { applyChange } from "./editing";
import { pickPdfFile } from "./fileActions";

const say = (text: string, kind: "info" | "error" | "success" = "info") => useStore.getState().showToast(text, kind);

/** New words are coloured in green; where words were taken out shows red. */
export const PUT_IN_COLOUR = "#7ee05c";
const BATCH = 24;

/** Each version's words, kept (by its pdf.js document) so going back and forth with Undo is quick. */
const known = new WeakMap<PDFDocumentProxy, { words: WordAt[]; bits: TextBox[][] }>();

/** Every page's words, a batch at a time; `progress` hears how many pages are read. */
async function readWords(doc: PDFDocumentProxy, progress: (read: number) => void): Promise<{ words: WordAt[]; bits: TextBox[][] }> {
  const got = known.get(doc);
  if (got) return got;
  const words: WordAt[] = [];
  const bits: TextBox[][] = [];
  for (let start = 0; start < doc.numPages; start += BATCH) {
    const pages = Array.from({ length: Math.min(BATCH, doc.numPages - start) }, (_, k) => start + k);
    const read = await Promise.all(pages.map((p) => pageTextBoxes(doc, p)));
    read.forEach((b, k) => {
      bits.push(b);
      words.push(...wordsIn(b, pages[k]));
    });
    progress(start + pages.length);
  }
  const out = { words, bits };
  known.set(doc, out);
  return out;
}

/** Where a change shows on this file: its words' boxes, or a thin bar where words were taken out. */
function placesFor(c: Change, bits: TextBox[][]): PlaceBox[] {
  const boxesOf = (w: WordAt) => w.pieces.map((p) => pieceBox(bits[w.page][p.bit], p.from, p.to, w.page)).filter((b) => b.width > 0 && b.height > 0);
  if (c.words.length) return c.words.flatMap(boxesOf);
  if (!c.near) return [];
  const boxes = boxesOf(c.near);
  const b = c.nearIsAfter ? boxes[0] : boxes[boxes.length - 1];
  if (!b) return [];
  if (b.turn) {
    const r = (b.turn * Math.PI) / 180;
    const along = c.nearIsAfter ? -3 : b.width;
    return [{ ...b, x: b.x + Math.cos(r) * along, y: b.y + Math.sin(r) * along, width: 3 }];
  }
  return [{ page: b.page, x: c.nearIsAfter ? b.x - 3 : b.x + b.width, y: b.y, width: 3, height: b.height }];
}

let ruler: CanvasRenderingContext2D | null = null;

/** How far along a bit of words letter `i` starts (0–1), measured in a font like most PDFs' (letters aren't all equally wide). */
function shareAt(str: string, i: number): number {
  if (i <= 0) return 0;
  if (i >= str.length) return 1;
  ruler ??= document.createElement("canvas").getContext("2d");
  if (!ruler) return i / str.length;
  ruler.font = "100px Helvetica, Arial, sans-serif";
  const all = ruler.measureText(str).width;
  return all > 0 ? ruler.measureText(str.slice(0, i)).width / all : i / str.length;
}

/** Letters `from` to `to` of a bit of words: upright, or turned along its line for words that aren't level. */
function pieceBox(bit: TextBox, from: number, to: number, page: number): PlaceBox {
  const a = bit.along;
  const s0 = shareAt(bit.str, from);
  const s1 = shareAt(bit.str, to);
  const pad = 0.5;
  if (!a) return { page, x: bit.x + bit.width * s0 - pad, y: bit.y - pad, width: bit.width * (s1 - s0) + pad * 2, height: bit.height + pad * 2 };
  const r = (a.turn * Math.PI) / 180;
  const start = a.length * s0;
  // Its bottom-left corner: a little below the baseline, for the tails of letters.
  const drop = a.size * 0.2;
  const x = a.x + Math.cos(r) * start - Math.sin(r) * drop;
  const y = a.y + Math.sin(r) * start + Math.cos(r) * drop;
  const height = a.size * 1.2;
  return { page, x, y: y - height, width: a.length * (s1 - s0), height, turn: a.turn };
}

let runs = 0;

/** Ask for the other PDF and compare the open one with it. */
export async function startComparing(): Promise<void> {
  if (!useStore.getState().pdf) return;
  let file: File | null;
  try {
    file = await pickPdfFile();
  } catch (e) {
    say(`Couldn't open it: ${e instanceof Error ? e.message : String(e)}`, "error");
    return;
  }
  if (file) await compareWith(file);
}

/** Compare the open PDF with `file`. */
export async function compareWith(file: File): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  if (!pdf) return;
  const run = ++runs;
  const otherName = file.name;
  let other: PDFDocumentProxy | null = null;
  useStore.getState().setCompare({ otherName, other: [], otherPages: 0, changes: [], places: [], forDoc: null, progress: `Reading ${otherName}…`, current: -1, scrollTo: false });
  useStore.getState().setSidePane("changes");
  try {
    other = await loadPdf(new Uint8Array(await file.arrayBuffer()));
    const pages = other.numPages;
    const { words } = await readWords(other, (read) => {
      if (run === runs) patch({ progress: `Reading ${otherName}: page ${read} of ${pages}…` });
    });
    if (run !== runs) return;
    patch({ other: words, otherPages: pages });
    await workOut(run);
  } catch (e) {
    if (run !== runs) return;
    useStore.getState().setCompare(null);
    if (e instanceof NeedsPassword) say(`${otherName} is protected by a password, so it can't be compared. Open it, save a copy without the password, and compare with that.`, "error");
    else say(`Couldn't read ${otherName}: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    if (other) known.delete(other);
    void other?.destroy();
  }
}

function patch(p: Partial<CompareState>): void {
  const c = useStore.getState().compare;
  if (c) useStore.getState().setCompare({ ...c, ...p });
}

/** Work out the differences for the version of the open PDF showing now. */
async function workOut(run: number): Promise<void> {
  const pdf = useStore.getState().pdf;
  const start = useStore.getState().compare;
  if (!pdf || !start) return;
  const pages = pdf.sizes.length;
  const { words, bits } = await readWords(pdf.doc, (read) => {
    if (run === runs && useStore.getState().pdf?.doc === pdf.doc) patch({ progress: `Reading this PDF: page ${read} of ${pages}…` });
  });
  const c = useStore.getState().compare;
  if (run !== runs || !c) return;
  // The file changed while its words were being read: start again on the new version.
  if (useStore.getState().pdf?.doc !== pdf.doc) return workOut(run);
  const changes = changesBetween(c.other, words);
  const places = (changes ?? []).map((ch) => placesFor(ch, bits));
  // Keep to the change being shown when the file changes under it (as near as there is).
  const current = c.current >= 0 && changes?.length ? Math.min(c.current, changes.length - 1) : -1;
  useStore.getState().setCompare({ ...c, changes, places, forDoc: pdf.doc, progress: null, current });
  if (c.forDoc !== null) return;
  // The first time: say what was found.
  if (!c.other.length || !words.length) {
    const which = !c.other.length && !words.length ? "Neither PDF has" : !words.length ? "This PDF has" : `${c.otherName} has`;
    say(`${which} no words to compare (scanned pages are pictures of words). “Read words in pictures” can find them first.`, "error");
  } else say(compareSummary(changes, c.otherName), changes?.length === 0 ? "success" : "info");
}

/** Show change `i`: go to its page and pick it out. */
export function showChange(i: number): void {
  const s = useStore.getState();
  const c = s.compare;
  const change = c?.changes?.[i];
  if (!c || !change) return;
  s.setCompare({ ...c, current: i, scrollTo: true });
  if (s.currentPage !== change.page || !c.places[i]?.length) s.goToPage(change.page);
}

/** The next or the one before (going round). */
export function stepChange(step: 1 | -1): void {
  const c = useStore.getState().compare;
  const n = c?.changes?.length ?? 0;
  if (!c || !n) return;
  showChange(c.current < 0 ? (step > 0 ? 0 : n - 1) : (c.current + step + n) % n);
}

export function stopComparing(): void {
  runs++;
  useStore.getState().setCompare(null);
}

/** Where a note about a change goes (its middle): just past the end of its last box, above the line. */
function noteSpot(b: PlaceBox): { x: number; y: number } {
  if (!b.turn) return { x: b.x + b.width + NOTE_SIZE / 2, y: b.y - NOTE_SIZE / 2 + 2 };
  const r = (b.turn * Math.PI) / 180;
  // The far end of its bottom edge, then "up" from the line (as its letters stand) past the letters.
  const ex = b.x + Math.cos(r) * b.width;
  const ey = b.y + b.height + Math.sin(r) * b.width;
  const up = b.height + NOTE_SIZE / 2;
  return { x: ex + Math.sin(r) * up, y: ey - Math.cos(r) * up };
}

let busy = false;

/** Write the differences into this PDF for good: new words highlighted green, a sticky note where words were taken out or changed. */
export async function markChanges(): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  const c = s.compare;
  if (busy || !pdf || !c?.changes?.length || c.forDoc !== pdf.doc) return;
  busy = true;
  try {
    const shapes: ShapeItem[] = [];
    const notes: NewNote[] = [];
    c.changes.forEach((ch, i) => {
      const places = c.places[i] ?? [];
      // (Words that aren't level get only a note: a highlight is always level.)
      const level = places.filter((p) => !p.turn);
      for (const page of new Set(ch.words.map((w) => w.page))) shapes.push(...highlightsFor(page, level.filter((p) => p.page === page), PUT_IN_COLOUR));
      const text = noteFor(ch, c.otherName) ?? (level.length < places.length ? `Put in (not in ${c.otherName}): “${ch.now}”` : null);
      const at = places[places.length - 1];
      if (!text || !at) return;
      const [w, h] = pdf.sizes[at.page];
      const middle = noteSpot(at);
      const spot = notePlace(middle.x, middle.y, w, h);
      notes.push({ page: at.page, ...spot, text, author: "Compare", colour: [1, 0.45, 0.45] });
    });
    let bytes = pdf.bytes;
    if (shapes.length) bytes = await addShapes(bytes, shapes);
    if (notes.length) bytes = await addNotes(bytes, notes);
    if (useStore.getState().pdf !== pdf) return;
    await applyChange(bytes, `mark ${c.changes.length === 1 ? "1 difference" : `${c.changes.length} differences`} from ${c.otherName}`);
    say("Marked: new words are highlighted green, and a red note shows where words were taken out or changed.", "success");
  } catch (e) {
    if (e instanceof LockedPdf) say("This PDF is locked against changes, so the differences can't be marked on it.", "error");
    else say(`Couldn't mark them: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    busy = false;
  }
}

// After every change to the open PDF (an edit, Undo, Redo), work the differences out again.
useStore.subscribe((s, prev) => {
  if (!s.compare || !s.pdf || s.pdf.doc === prev.pdf?.doc || s.compare.forDoc === null) return;
  void workOut(++runs);
});
