/**
 * Sticky notes in the app: the notes in each version of the PDF (read once
 * per version), adding one with a click, and saving, moving or taking one
 * away (each its own step in Undo).
 */
import { DEFAULT_NOTE_COLOUR, NOTE_COLOURS, notePlace, type Note, type OpenNote, type Rgb } from "../model/notes";
import { useStore } from "../model/store";
import { addNote, changeNote, listNotes, NoteProblem, removeNote } from "../pdf/notes";
import { LockedPdf, peekForReading } from "../pdf/watermark";
import { cancelAdding, finishAdding } from "./addActions";
import { applyChange } from "./editing";

const say = (text: string, kind: "info" | "error" | "success" = "info") => useStore.getState().showToast(text, kind);

const read = new WeakMap<Uint8Array, Promise<Note[]>>();
const known = new WeakMap<Uint8Array, Note[]>();

/** Every note in this version of the PDF (none when it can't be read). */
export function notesIn(bytes: Uint8Array): Promise<Note[]> {
  let found = read.get(bytes);
  if (!found) {
    found = peekForReading(bytes)
      .then((doc) => (doc ? listNotes(doc) : []))
      .catch(() => [])
      .then((notes) => {
        known.set(bytes, notes);
        return notes;
      });
    read.set(bytes, found);
  }
  return found;
}

/** The notes in this version, if they've been read already. */
export const notesKnown = (bytes: Uint8Array): Note[] | null => known.get(bytes) ?? null;

const NAME_KEY = "jurapdf.noteName";
const COLOUR_KEY = "jurapdf.noteColour";

/** The name put on new notes (remembered on this computer). */
export function noteName(): string {
  try {
    return globalThis.localStorage?.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function lastColour(): Rgb {
  try {
    const name = globalThis.localStorage?.getItem(COLOUR_KEY);
    return NOTE_COLOURS.find((c) => c.name === name)?.rgb ?? DEFAULT_NOTE_COLOUR;
  } catch {
    return DEFAULT_NOTE_COLOUR;
  }
}

function remember(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Not remembered; it still works now.
  }
}

/** The note tool: the next click on a page puts a note there. */
export async function startNoting(): Promise<void> {
  const s = useStore.getState();
  if (!s.pdf) return;
  if (s.draft) await finishAdding();
  s.setNote(null);
  useStore.getState().setPlacing({ kind: "note" });
  say("Click on a page where the note should go. Esc stops.");
}

/** A click at (x, y) points on page `page` while the note tool is on: a new note opens there to type in. */
export function placeNote(page: number, x: number, y: number): void {
  const s = useStore.getState();
  const size = s.pdf?.sizes[page];
  if (!size) return;
  cancelAdding();
  s.setNote({ page, ...notePlace(x, y, size[0], size[1]), text: "", author: noteName(), colour: lastColour(), when: "", replies: [] });
}

/** Open a note that's in the PDF, to read or change it. */
export function openNote(note: Note): void {
  const s = useStore.getState();
  if (s.placing || s.draft) cancelAdding();
  const { id, page, x, y, text, author, colour, when, replies } = note;
  s.setNote({ id, page, x, y, text, author, colour, when, replies });
}

export const closeNote = () => useStore.getState().setNote(null);

/** Saves what's typed in the open note's window (set by the window while it's open). */
let saveOpen: (() => Promise<void>) | null = null;

export function whileOpen(save: (() => Promise<void>) | null): void {
  saveOpen = save;
}

/** A click away from an open note: it's saved (as typed) and closes. */
export async function finishNote(): Promise<void> {
  if (saveOpen) await saveOpen();
  else closeNote();
}

function problem(e: unknown, what: string): void {
  if (e instanceof NoteProblem) say(e.message, "error");
  else if (e instanceof LockedPdf) say("This PDF is locked against changes, so notes can't be added to it here.", "error");
  else say(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`, "error");
}

let busy = false;

async function change(work: (bytes: Uint8Array) => Promise<Uint8Array<ArrayBuffer>>, label: string, what: string): Promise<boolean> {
  const pdf = useStore.getState().pdf;
  if (!pdf || busy) return false;
  busy = true;
  try {
    const bytes = await work(pdf.bytes);
    if (useStore.getState().pdf !== pdf) return false;
    await applyChange(bytes, label);
    return true;
  } catch (e) {
    problem(e, what);
    return false;
  } finally {
    busy = false;
  }
}

/** Save what's typed in the open note (a new note with nothing typed just closes). */
export async function saveNote(note: OpenNote, text: string, author: string, colour: Rgb): Promise<void> {
  const name = author.trim();
  remember(NAME_KEY, name);
  remember(COLOUR_KEY, NOTE_COLOURS.find((c) => c.rgb === colour)?.name ?? "");
  const page = `page ${note.page + 1}`;
  if (!note.id) {
    if (!text.trim()) return closeNote();
    if (await change(async (b) => (await addNote(b, { page: note.page, x: note.x, y: note.y, text, author: name, colour })).bytes, `add a note on ${page}`, "add the note")) closeNote();
    return;
  }
  const id = note.id;
  const same = text === note.text && name === note.author && colour.every((c, i) => Math.abs(c - note.colour[i]) < 0.005);
  if (same) return closeNote();
  if (await change((b) => changeNote(b, id, { text, author: name, colour }), `change the note on ${page}`, "change the note")) closeNote();
}

/** Take a note away (with its replies). */
export async function deleteNote(note: { id?: string; page: number }): Promise<void> {
  const id = note.id;
  if (!id) return closeNote();
  if (await change((b) => removeNote(b, id), `delete the note on page ${note.page + 1}`, "delete the note")) closeNote();
}

/** Move a note's icon to (x, y) points on its page. */
export async function moveNote(note: Note, x: number, y: number): Promise<void> {
  await change((b) => changeNote(b, note.id, { x, y }), `move the note on page ${note.page + 1}`, "move the note");
}

/** Go to a note (from the Notes list) and open it. */
export function showNote(note: Note): void {
  useStore.getState().goToPage(note.page);
  openNote(note);
}
