/**
 * Filling in a PDF's own form (any PDF's, not only boxes JuraPDF added), with
 * pdf-lib: reading what's in it, writing answers, and making the answers part
 * of the page ("flattening", so they can't be changed any more). Works in the
 * browser and in Node (Claude's tools).
 */
import { PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField, PDFBool, type PDFField } from "pdf-lib";

import { fieldLabel, type Answer, type FormFieldInfo } from "../model/forms";
import { keptOn, setKept } from "./items";
import { loadForEditing, peekForReading, saveEdited } from "./watermark";

/** Something about an answer that can't be done, said kindly. */
export class FormProblem extends Error {}

const quoted = (name: string) => `“${fieldLabel(name)}”`;

/** Which page (from 0) each form box's drawing is on. */
function pagesOfWidgets(doc: PDFDocument): Map<PDFDict, number> {
  const at = new Map<PDFDict, number>();
  doc.getPages().forEach((page, i) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const a = annots.lookup(k);
      if (a instanceof PDFDict) at.set(a, i);
    }
  });
  return at;
}

function describe(field: PDFField, pageOf: Map<PDFDict, number>): FormFieldInfo {
  const name = field.getName();
  const pages = [...new Set(field.acroField.getWidgets().map((w) => pageOf.get(w.dict)).filter((p): p is number => p !== undefined))].sort((a, b) => a - b);
  const readOnly = field.isReadOnly() || undefined;
  if (field instanceof PDFTextField) return { name, kind: "text", value: field.getText() ?? "", multiline: field.isMultiline() || undefined, readOnly, pages };
  if (field instanceof PDFCheckBox) return { name, kind: "tick", value: field.isChecked(), readOnly, pages };
  if (field instanceof PDFRadioGroup) return { name, kind: "radio", value: field.getSelected() ?? "", options: field.getOptions(), readOnly, pages };
  if (field instanceof PDFDropdown) return { name, kind: "choice", value: field.getSelected()[0] ?? "", options: field.getOptions(), readOnly, pages };
  if (field instanceof PDFOptionList) return { name, kind: "list", value: field.getSelected(), options: field.getOptions(), readOnly, pages };
  if (field instanceof PDFSignature) return { name, kind: "signature", value: "", readOnly, pages };
  return { name, kind: "button", value: "", readOnly, pages };
}

/** Every field in the PDF's form, in the form's own order (none when it has no form or can't be read). */
export async function formFields(bytes: Uint8Array): Promise<FormFieldInfo[]> {
  const doc = await peekForReading(bytes);
  if (!doc) return [];
  try {
    const pageOf = pagesOfWidgets(doc);
    return doc.getForm().getFields().map((f) => describe(f, pageOf));
  } catch {
    return [];
  }
}

/** Write one answer into its field (a FormProblem when it doesn't fit). */
function answer(doc: PDFDocument, a: Answer): void {
  const form = doc.getForm();
  const field = form.getFieldMaybe(a.name);
  if (!field) throw new FormProblem(`This PDF's form has no box called ${quoted(a.name)}.`);
  if (field.isReadOnly()) throw new FormProblem(`${quoted(a.name)} can't be changed (the form doesn't allow it).`);
  const v = a.value;
  if (field instanceof PDFTextField) {
    const words = Array.isArray(v) ? v.join(", ") : String(v);
    const most = field.getMaxLength();
    if (most !== undefined && words.length > most) throw new FormProblem(`${quoted(a.name)} takes at most ${most} letters.`);
    try {
      const font = form.getDefaultFont();
      for (const line of words.split(/\r\n|\r|\n/)) font.encodeText(line);
    } catch {
      throw new FormProblem(`Some of those letters can't be written in ${quoted(a.name)} (form boxes are written with a font that covers English and most European letters).`);
    }
    // Several lines with "fit the box" come out far too big with pdf-lib: a size that fits the lines is set instead.
    if (field.isMultiline() && words) fitLines(field, words.split(/\r\n|\r|\n/).length);
    field.setText(words === "" ? undefined : words);
  } else if (field instanceof PDFCheckBox) {
    if (v === true || v === "true") field.check();
    else field.uncheck();
  } else if (field instanceof PDFRadioGroup) {
    const pick = Array.isArray(v) ? (v[0] ?? "") : String(v);
    if (pick === "" || v === false) field.clear();
    else {
      if (field.getOptions().includes(pick)) field.select(pick);
      else {
        // The app picks a round button by its own name for "on" (what pdf.js tells), which can differ from the choice's name.
        const widgets = field.acroField.getWidgets();
        const on = widgets.map((w) => w.getOnValue()).find((v) => v?.decodeText() === pick);
        if (!on) throw new FormProblem(`${quoted(a.name)} has no choice “${pick}”.`);
        field.acroField.dict.set(PDFName.of("V"), on);
        for (const w of widgets) w.setAppearanceState(w.getOnValue() === on ? on : PDFName.of("Off"));
      }
    }
  } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const picks = (Array.isArray(v) ? v : [String(v)]).filter((p) => p !== "");
    if (!picks.length) field.clear();
    else {
      const options = field.getOptions();
      const editable = field instanceof PDFDropdown && field.isEditable();
      const odd = picks.find((p) => !options.includes(p));
      if (odd !== undefined && !editable) throw new FormProblem(`${quoted(a.name)} has no choice “${odd}”.`);
      if (picks.length > 1 && !field.isMultiselect()) throw new FormProblem(`${quoted(a.name)} takes just one choice.`);
      field.select(picks.length === 1 ? picks[0] : picks);
    }
  } else {
    throw new FormProblem(`${quoted(a.name)} is a button or signature box, which can't be filled in here.`);
  }
}

const SIZE_IN_DA = /([\d.]+)(\s+Tf)/;

/**
 * A several-line text box whose letter size is "fit the box", more than 12 or too big for
 * `lines` lines gets a size that fits them (pdf-lib's own fitting makes them
 * far too big), wherever its size is set.
 */
function fitLines(field: PDFTextField, lines: number): void {
  const widgets = field.acroField.getWidgets();
  const holders: { get(): string | undefined; set(da: string): void }[] = [
    { get: () => field.acroField.getDefaultAppearance(), set: (da) => field.acroField.setDefaultAppearance(da) },
    ...widgets.map((w) => ({ get: () => w.getDefaultAppearance(), set: (da: string) => w.setDefaultAppearance(da) })),
  ];
  const height = widgets[0]?.getRectangle().height ?? 40;
  const fits = Math.max(4, Math.floor(((height - 4) / (lines * 1.2)) * 2) / 2);
  for (const h of holders) {
    const da = h.get();
    const m = da ? SIZE_IN_DA.exec(da) : null;
    if (!da || !m) continue;
    const size = Number(m[1]);
    const want = Math.min(size > 0 ? size : 12, fits, 12);
    if (want !== size) h.set(da.replace(SIZE_IN_DA, `${want}$2`));
  }
}

/** Ask readers to draw the boxes' contents themselves (when pdf-lib couldn't draw them). */
function letReadersDraw(doc: PDFDocument): void {
  doc.getForm().acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
}

/** Save after filling in, drawing what's in each box changed (or, if that can't be done, leaving it to readers). */
async function saveFilled(doc: PDFDocument): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return await saveEdited(doc);
  } catch {
    letReadersDraw(doc);
    return await saveEdited(doc, { updateFieldAppearances: false });
  }
}

/** The PDF with these answers written into its form (one new version). */
export async function fillForm(bytes: Uint8Array, answers: readonly Answer[]): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  for (const a of answers) answer(doc, a);
  return saveFilled(doc);
}

/** Empty every box in the form that can be changed. */
export async function clearForm(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  for (const field of doc.getForm().getFields()) {
    if (field.isReadOnly()) continue;
    if (field instanceof PDFTextField) field.setText(undefined);
    else if (field instanceof PDFCheckBox) field.uncheck();
    else if (field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList) field.clear();
  }
  return saveFilled(doc);
}

/**
 * Make what's filled in part of the pages, and take the form away: the answers
 * stay where they are but can't be changed any more (in any reader).
 */
export async function flattenForm(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  const form = doc.getForm();
  if (!form.getFields().length) throw new FormProblem("This PDF has no form boxes.");
  // Its form boxes may sit on pages pdf-lib doesn't link them to: they're found by looking through each page.
  const pageOf = pagesOfWidgets(doc);
  for (const field of form.getFields()) {
    for (const w of field.acroField.getWidgets()) {
      const at = pageOf.get(w.dict);
      if (!w.P() && at !== undefined) w.setP(doc.getPages()[at].ref);
    }
  }
  try {
    form.flatten();
  } catch {
    throw new FormProblem("This PDF's form couldn't be made part of the pages (some of its boxes are drawn in a way JuraPDF can't copy).");
  }
  // Form boxes JuraPDF added are no longer boxes, so they're no longer remembered as its own.
  doc.getPages().forEach((page, i) => {
    const kept = keptOn(page, i);
    if (kept.some((k) => k.item.kind === "field")) setKept(page, kept.filter((k) => k.item.kind !== "field"));
  });
  return saveEdited(doc);
}
