/**
 * Sticky notes in the PDF itself, with pdf-lib: PDF "Text" notes, the kind
 * Acrobat, Preview and other readers show as a little note icon that opens to
 * show its words. Reads every reader's notes (and their replies), and adds,
 * changes and takes away notes. Works in the browser and in Node (Claude's tools).
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from "pdf-lib";

import { colourFrom, DEFAULT_NOTE_COLOUR, NOTE_SIZE, pdfDate, withReplies, type Note, type Rgb } from "../model/notes";
import { fromPageSpace, shownSize, toPageSpace } from "../model/watermark";
import { frameOf, loadForEditing, saveEdited } from "./watermark";

/** Something about a note that can't be done, said kindly. */
export class NoteProblem extends Error {}

const N = (name: string) => PDFName.of(name);

/** Hidden notes (flag 2) and ones that aren't shown on screen (NoView, 32) aren't listed. */
const HIDDEN = 2 | 32;
/** Notes are printed with "Document and markups", stay the same size at any zoom, and don't turn with the page (as Acrobat writes them). */
const FLAGS = 4 | 8 | 16;

const idOf = (ref: PDFRef) => `${ref.objectNumber}R${ref.generationNumber ? ref.generationNumber : ""}`;

function textOf(dict: PDFDict, key: string): string {
  const v = dict.lookup(N(key));
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : "";
}

function numbersOf(v: PDFObject | undefined): number[] {
  if (!(v instanceof PDFArray)) return [];
  const out: number[] = [];
  for (let i = 0; i < v.size(); i++) {
    const n = v.lookup(i);
    out.push(n instanceof PDFNumber ? n.asNumber() : NaN);
  }
  return out;
}

interface Found {
  id: string;
  page: number;
  dict: PDFDict;
}

/** Every note in the PDF (Text notes, replies too), with its id: the PDF's own number for it, or "p3a5" (page 3's fifth) when it hasn't one. */
function allNotes(doc: PDFDocument): Found[] {
  const out: Found[] = [];
  doc.getPages().forEach((page, p) => {
    const annots = page.node.lookup(N("Annots"));
    if (!(annots instanceof PDFArray)) return;
    for (let i = 0; i < annots.size(); i++) {
      const raw = annots.get(i);
      const dict = annots.lookup(i);
      if (!(dict instanceof PDFDict) || dict.lookup(N("Subtype")) !== N("Text")) continue;
      out.push({ id: raw instanceof PDFRef ? idOf(raw) : `p${p}a${i}`, page: p, dict });
    }
  });
  return out;
}

/** Every note in the PDF with its replies, page by page, placed as shown (points from each page's top-left). */
export function listNotes(doc: PDFDocument): Note[] {
  const pages = doc.getPages();
  const found = allNotes(doc);
  const notes = found.flatMap(({ id, page, dict }) => {
    const flags = dict.lookup(N("F"));
    if (flags instanceof PDFNumber && flags.asNumber() & HIDDEN) return [];
    const r = numbersOf(dict.lookup(N("Rect")));
    if (r.length < 4 || r.some(Number.isNaN)) return [];
    const frame = frameOf(pages[page]);
    const [, shownH] = shownSize(frame);
    // The icon stays upright, hanging from its box's top-left corner in the page's own space.
    const corner = fromPageSpace(frame, Math.min(r[0], r[2]), Math.max(r[1], r[3]));
    const irt = dict.get(N("IRT"));
    const replyKind = dict.lookup(N("RT"));
    return [
      {
        id,
        page,
        x: corner.x,
        y: shownH - corner.y,
        width: Math.max(4, Math.abs(r[2] - r[0])),
        height: Math.max(4, Math.abs(r[3] - r[1])),
        text: textOf(dict, "Contents"),
        author: textOf(dict, "T"),
        colour: colourFrom(numbersOf(dict.lookup(N("C")))) ?? DEFAULT_NOTE_COLOUR,
        when: textOf(dict, "M") || textOf(dict, "CreationDate"),
        replies: [],
        // A "group" of notes (RT /Group) isn't a reply; each still shows.
        inReplyTo: irt instanceof PDFRef && replyKind !== N("Group") ? idOf(irt) : undefined,
      },
    ];
  });
  return withReplies(notes);
}

function find(doc: PDFDocument, id: string): Found {
  const one = allNotes(doc).find((n) => n.id === id);
  if (!one) throw new NoteProblem("That note isn't in the PDF any more.");
  return one;
}

/** A note's box in the page's own space, for its icon's top-left at (x, y) as shown. */
function rectFor(doc: PDFDocument, page: number, x: number, y: number, width = NOTE_SIZE, height = NOTE_SIZE): number[] {
  const frame = frameOf(doc.getPage(page));
  const [w, h] = shownSize(frame);
  const left = Math.max(0, Math.min(w - width, x));
  const top = Math.max(0, Math.min(h - height, y));
  // A note's icon doesn't turn with the page: it stays upright with its top-left corner (the box's top-left in the page's own space) where it was put.
  const corner = toPageSpace(frame, left, h - top, 0);
  return [corner.x, corner.y - height, corner.x + width, corner.y];
}

export interface NewNote {
  /** Page, from 0. */
  page: number;
  /** The icon's top-left, points from the page's top-left as shown. */
  x: number;
  y: number;
  text: string;
  author?: string;
  colour?: Rgb;
}

/** The PDF with a new note on a page; also gives the new note's id. */
export async function addNote(bytes: Uint8Array, note: NewNote, now = new Date()): Promise<{ bytes: Uint8Array<ArrayBuffer>; id: string }> {
  const doc = await loadForEditing(bytes);
  if (note.page < 0 || note.page >= doc.getPageCount()) throw new NoteProblem(`There's no page ${note.page + 1}.`);
  const page = doc.getPage(note.page);
  const when = PDFString.of(pdfDate(now));
  const dict = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: rectFor(doc, note.page, note.x, note.y),
    Contents: PDFHexString.fromText(note.text),
    T: PDFHexString.fromText(note.author ?? ""),
    C: [...(note.colour ?? DEFAULT_NOTE_COLOUR)],
    Name: "Comment",
    F: FLAGS,
    M: when,
    CreationDate: when,
    NM: PDFString.of(`jurapdf-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
    Open: false,
    P: page.ref,
  });
  const ref = doc.context.register(dict);
  page.node.addAnnot(ref);
  return { bytes: await saveEdited(doc), id: idOf(ref) };
}

export interface NoteChange {
  text?: string;
  colour?: Rgb;
  author?: string;
  /** A new place for its icon (points from the page's top-left, as shown). */
  x?: number;
  y?: number;
}

/** The PDF with a note's words, colour or place changed. */
export async function changeNote(bytes: Uint8Array, id: string, change: NoteChange, now = new Date()): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  const { page, dict } = find(doc, id);
  if (change.text !== undefined) dict.set(N("Contents"), PDFHexString.fromText(change.text));
  if (change.author !== undefined) dict.set(N("T"), PDFHexString.fromText(change.author));
  if (change.colour) {
    dict.set(N("C"), doc.context.obj([...change.colour]));
    // A drawing of the icon made by another reader would still show the old colour: readers draw it afresh without one.
    dict.delete(N("AP"));
  }
  if (change.x !== undefined && change.y !== undefined) {
    const r = numbersOf(dict.lookup(N("Rect")));
    const w = r.length === 4 ? Math.abs(r[2] - r[0]) || NOTE_SIZE : NOTE_SIZE;
    const h = r.length === 4 ? Math.abs(r[3] - r[1]) || NOTE_SIZE : NOTE_SIZE;
    dict.set(N("Rect"), doc.context.obj(rectFor(doc, page, change.x, change.y, w, h)));
    // Its pop-up window (where other readers show its words) goes along with it.
    const popup = dict.lookup(N("Popup"));
    if (popup instanceof PDFDict) popup.delete(N("Rect"));
  }
  dict.set(N("M"), PDFString.of(pdfDate(now)));
  return saveEdited(doc);
}

/** The PDF without a note, its replies, or the pop-up windows other readers keep for them. */
export async function removeNote(bytes: Uint8Array, id: string): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  const { dict } = find(doc, id);
  const gone = new Set<PDFDict>([dict]);
  const pages = doc.getPages();
  const lists = pages.map((p) => p.node.lookup(N("Annots"))).filter((a): a is PDFArray => a instanceof PDFArray);
  const pointsAtGone = (a: PDFDict, key: string) => {
    const to = a.lookup(N(key));
    return to instanceof PDFDict && gone.has(to);
  };
  // Replies to it (and replies to those), and the pop-ups of everything going.
  for (let more = true; more; ) {
    more = false;
    for (const list of lists)
      for (let i = 0; i < list.size(); i++) {
        const a = list.lookup(i);
        if (a instanceof PDFDict && !gone.has(a) && (pointsAtGone(a, "IRT") || pointsAtGone(a, "Parent"))) {
          gone.add(a);
          more = true;
        }
      }
  }
  for (const a of [...gone]) {
    const popup = a.lookup(N("Popup"));
    if (popup instanceof PDFDict) gone.add(popup);
  }
  for (const list of lists) for (let i = list.size() - 1; i >= 0; i--) if (gone.has(list.lookup(i) as PDFDict)) list.remove(i);
  return saveEdited(doc);
}
