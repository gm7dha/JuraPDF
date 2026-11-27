/**
 * Filling in forms in JuraPDF itself: the boxes on each page (read with
 * pdf.js for each version of the PDF), and answers written one at a time,
 * each its own step in Undo ("fill in “Name”").
 */
import { answerLabel, type FormBox, type FormBoxKind, type FormValue } from "../model/forms";
import { useStore } from "../model/store";
import { clearForm, fillForm, flattenForm, formFields, FormProblem } from "../pdf/forms";
import { formBoxes, type PDFDocumentProxy } from "../pdf/pdfjs";
import { LockedPdf } from "../pdf/watermark";
import { applyChange } from "./editing";

const say = (text: string, kind: "info" | "error" | "success" = "info") => useStore.getState().showToast(text, kind);

const boxes = new WeakMap<PDFDocumentProxy, Map<number, Promise<FormBox[]>>>();

/** The form boxes on page `index` of this version (none when it has none or they can't be read). */
export function formBoxesOn(doc: PDFDocumentProxy, index: number): Promise<FormBox[]> {
  let map = boxes.get(doc);
  if (!map) boxes.set(doc, (map = new Map()));
  let found = map.get(index);
  if (!found) {
    found = doc
      .getPage(index + 1)
      .then(formBoxes)
      .catch(() => []);
    map.set(index, found);
  }
  return found;
}

const hasForms = new WeakMap<PDFDocumentProxy, Promise<boolean>>();

/** Whether this version of the PDF has a form to fill in. */
export function hasForm(doc: PDFDocumentProxy): Promise<boolean> {
  let known = hasForms.get(doc);
  if (!known) {
    known = doc
      .getFieldObjects()
      .then((fields) => !!fields && Object.keys(fields).length > 0)
      .catch(() => false);
    hasForms.set(doc, known);
  }
  return known;
}

function problem(e: unknown, what: string): void {
  if (e instanceof FormProblem) say(e.message, "error");
  else if (e instanceof LockedPdf) say("This PDF is locked against changes, so its form can't be filled in here.", "error");
  else say(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`, "error");
}

/** Answers are written one after another, each on the version the one before made. */
let queue: Promise<unknown> = Promise.resolve();

function inTurn(work: () => Promise<void>): Promise<void> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Write an answer into the form: words, a tick, a round button's "on" name,
 * or the choices picked (as the list shows them). Resolves false if it couldn't.
 */
export function fillIn(name: string, kind: FormBoxKind, value: FormValue): Promise<boolean> {
  let done = false;
  return inTurn(async () => {
    const pdf = useStore.getState().pdf;
    if (!pdf) return;
    try {
      const bytes = await fillForm(pdf.bytes, [{ name, value }]);
      // The PDF may have changed meanwhile (Undo, another file): then this answer is let go.
      if (useStore.getState().pdf !== pdf) return;
      let label = answerLabel(kind, name, value);
      if (kind === "radio") {
        // A round button is picked by its own name for "on" ("1"); Undo names the choice ("Blue").
        const picked = (await formFields(bytes)).find((f) => f.name === name)?.value;
        if (typeof picked === "string" && picked) label = answerLabel(kind, name, picked);
      }
      await applyChange(bytes, label);
      done = true;
    } catch (e) {
      problem(e, "fill that in");
    }
  }).then(() => done);
}

/** Empty every box in the form (one step in Undo). */
export function emptyForm(): Promise<void> {
  return inTurn(async () => {
    const pdf = useStore.getState().pdf;
    if (!pdf) return;
    try {
      await applyChange(await clearForm(pdf.bytes), "empty the form");
      say("The form is empty again. Undo brings the answers back.", "info");
    } catch (e) {
      problem(e, "empty the form");
    }
  });
}

/** Make what's filled in part of the pages, so it can't be changed (one step in Undo). */
export function fixAnswers(): Promise<void> {
  return inTurn(async () => {
    const pdf = useStore.getState().pdf;
    if (!pdf) return;
    try {
      await applyChange(await flattenForm(pdf.bytes), "make the answers part of the pages");
      say("The answers are now part of the pages, and the form boxes are gone. Undo brings them back.", "success");
    } catch (e) {
      problem(e, "make the answers part of the pages");
    }
  });
}
