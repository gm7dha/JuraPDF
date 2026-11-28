import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { FieldItem } from "../src/model/additions";
import { answerFor, answerLabel, DATE_FORMATS, dateForBox, dateFormatIn, fieldLabel, fitFontSize, formBoxesFrom, readDate, sameValue, tabOrder, writeDate, type FormFieldInfo } from "../src/model/forms";
import { fitInBox } from "../src/model/signature";
import { addItems, changeItem } from "../src/pdf/additions";
import { keptIn } from "../src/pdf/items";
import { clearForm, fillForm, flattenForm, formFields, FormProblem } from "../src/pdf/forms";

const STANDARD_FONTS = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;

/** A one-page form with one of each kind of box (and a second page with a copy of the name box). */
async function aForm(turn = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  if (turn) page.setRotation(degrees(turn));
  const two = doc.addPage([400, 500]);
  const form = doc.getForm();
  const name = form.createTextField("person.name");
  name.addToPage(page, { x: 50, y: 400, width: 200, height: 20 });
  name.addToPage(two, { x: 50, y: 100, width: 200, height: 20 });
  form.createTextField("notes").addToPage(page, { x: 50, y: 300, width: 200, height: 60 });
  form.getTextField("notes").enableMultiline();
  const short = form.createTextField("code");
  short.setMaxLength(3);
  short.addToPage(page, { x: 300, y: 400, width: 50, height: 20 });
  form.createCheckBox("agree").addToPage(page, { x: 50, y: 250, width: 14, height: 14 });
  const colour = form.createRadioGroup("colour");
  colour.addOptionToPage("Red", page, { x: 50, y: 200, width: 14, height: 14 });
  colour.addOptionToPage("Blue", page, { x: 100, y: 200, width: 14, height: 14 });
  const shift = form.createDropdown("shift");
  shift.setOptions(["Day", "Night"]);
  shift.addToPage(page, { x: 50, y: 150, width: 100, height: 20 });
  const tools = form.createOptionList("tools");
  tools.setOptions(["Hammer", "Saw", "Drill"]);
  tools.enableMultiselect();
  tools.addToPage(page, { x: 200, y: 100, width: 100, height: 60 });
  const fixed = form.createTextField("fixed");
  fixed.setText("Can't touch");
  fixed.enableReadOnly();
  fixed.addToPage(page, { x: 300, y: 300, width: 80, height: 20 });
  return doc.save();
}

async function boxesOn(bytes: Uint8Array, n: number) {
  const pdf = await getDocument({ data: bytes.slice(), standardFontDataUrl: STANDARD_FONTS, isEvalSupported: false }).promise;
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const boxes = formBoxesFrom(await page.getAnnotations(), (r) => vp.convertToViewportRectangle(r));
  await pdf.destroy();
  return boxes;
}

describe("reading a form", () => {
  it("lists every field with its kind, answer, choices and pages", async () => {
    const fields = await formFields(await aForm());
    const by = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(by["person.name"]).toMatchObject({ kind: "text", value: "", pages: [0, 1] });
    expect(by.notes).toMatchObject({ kind: "text", multiline: true });
    expect(by.agree).toMatchObject({ kind: "tick", value: false });
    expect(by.colour).toMatchObject({ kind: "radio", options: ["Red", "Blue"] });
    expect(by.shift).toMatchObject({ kind: "choice", options: ["Day", "Night"] });
    expect(by.tools).toMatchObject({ kind: "list", value: [] });
    expect(by.fixed).toMatchObject({ readOnly: true, value: "Can't touch" });
  });

  it("finds the boxes on a page where they show (from the top-left), with pdf.js", async () => {
    const boxes = await boxesOn(await aForm(), 1);
    const name = boxes.find((b) => b.name === "person.name")!;
    // (pdf-lib widens a box by half its border all round.)
    expect(name).toMatchObject({ kind: "text", x: 49.5, y: 79.5, width: 201, height: 21 });
    const radios = boxes.filter((b) => b.kind === "radio");
    // (pdf-lib calls the round buttons "0" and "1" inside, and the choices Red and Blue.)
    expect(radios.map((r) => r.onValue)).toEqual(["0", "1"]);
    expect(boxes.find((b) => b.name === "tools")).toMatchObject({ kind: "list", several: true });
    expect(boxes.find((b) => b.name === "shift")?.options?.map((o) => o.label)).toEqual(["Day", "Night"]);
    expect(boxes.find((b) => b.name === "fixed")?.readOnly).toBe(true);
    expect((await boxesOn(await aForm(), 2)).map((b) => b.name)).toEqual(["person.name"]);
  });

  it("turns boxes with a turned page", async () => {
    const name = (await boxesOn(await aForm(90), 1)).find((b) => b.name === "person.name")!;
    // Turned a quarter clockwise: the page shows 500 wide, and the box stands upright on its left.
    expect(name).toMatchObject({ x: 399.5, y: 49.5, width: 21, height: 201 });
  });
});

describe("filling in a form", () => {
  it("writes each kind of answer, which pdf.js then reads back", async () => {
    const bytes = await fillForm(await aForm(), [
      { name: "person.name", value: "Kevin" },
      { name: "notes", value: "Line one\nLine two" },
      { name: "agree", value: true },
      { name: "colour", value: "Blue" },
      { name: "shift", value: "Night" },
      { name: "tools", value: ["Saw", "Drill"] },
    ]);
    const by = Object.fromEntries((await formFields(bytes)).map((f) => [f.name, f.value]));
    expect(by).toMatchObject({ "person.name": "Kevin", notes: "Line one\nLine two", agree: true, colour: "Blue", shift: "Night", tools: ["Saw", "Drill"] });
    const boxes = await boxesOn(bytes, 1);
    expect(boxes.find((b) => b.name === "person.name")?.value).toBe("Kevin");
    expect(boxes.find((b) => b.name === "agree")?.value).toBe(true);
    expect(boxes.filter((b) => b.kind === "radio").map((b) => b.value)).toEqual([false, true]);
    // The app picks a round button by its name for "on".
    const red = await fillForm(bytes, [{ name: "colour", value: "0" }]);
    expect((await formFields(red)).find((f) => f.name === "colour")?.value).toBe("Red");
    expect((await boxesOn(red, 1)).filter((b) => b.kind === "radio").map((b) => b.value)).toEqual([true, false]);
    expect(boxes.find((b) => b.name === "shift")?.value).toEqual(["Night"]);
    // The same box on page 2 shows the same answer.
    expect((await boxesOn(bytes, 2))[0].value).toBe("Kevin");
  });

  it("clears answers and unticks", async () => {
    const filled = await fillForm(await aForm(), [
      { name: "person.name", value: "Kevin" },
      { name: "agree", value: true },
    ]);
    const again = await fillForm(filled, [
      { name: "person.name", value: "" },
      { name: "agree", value: false },
    ]);
    const by = Object.fromEntries((await formFields(again)).map((f) => [f.name, f.value]));
    expect(by).toMatchObject({ "person.name": "", agree: false });
    const cleared = Object.fromEntries((await formFields(await clearForm(filled))).map((f) => [f.name, f.value]));
    expect(cleared).toMatchObject({ "person.name": "", agree: false, fixed: "Can't touch" });
  });

  it("says kindly what can't be done", async () => {
    const form = await aForm();
    await expect(fillForm(form, [{ name: "nope", value: "x" }])).rejects.toThrow(/no box called “nope”/);
    await expect(fillForm(form, [{ name: "fixed", value: "x" }])).rejects.toThrow(FormProblem);
    await expect(fillForm(form, [{ name: "code", value: "ABCD" }])).rejects.toThrow(/at most 3 letters/);
    await expect(fillForm(form, [{ name: "shift", value: "Evening" }])).rejects.toThrow(/no choice “Evening”/);
    await expect(fillForm(form, [{ name: "colour", value: "Green" }])).rejects.toThrow(/no choice/);
    await expect(fillForm(form, [{ name: "person.name", value: "日本" }])).rejects.toThrow(/letters can't be written/);
  });

  it("makes the answers part of the page, leaving no form", async () => {
    const filled = await fillForm(await aForm(), [{ name: "person.name", value: "Kevin" }]);
    const flat = await flattenForm(filled);
    expect(await formFields(flat)).toEqual([]);
    const pdf = await getDocument({ data: flat.slice(), standardFontDataUrl: STANDARD_FONTS, isEvalSupported: false }).promise;
    const page = await pdf.getPage(1);
    expect(await page.getAnnotations()).toEqual([]);
    await pdf.destroy();
    await expect(flattenForm(flat)).rejects.toThrow(/no form boxes/);
  });
});

describe("answers in words", () => {
  const field = (f: Partial<FormFieldInfo>): FormFieldInfo => ({ name: "x", kind: "text", value: "", pages: [0], ...f });

  it("names each answer for the Undo list", () => {
    expect(answerLabel("text", "person.name", "Kevin")).toBe("fill in “name”");
    expect(answerLabel("text", "Work order", "")).toBe("clear “Work order”");
    expect(answerLabel("tick", "agree", true)).toBe("tick “agree”");
    expect(answerLabel("tick", "agree", false)).toBe("untick “agree”");
    expect(answerLabel("radio", "colour", "Blue")).toBe("pick “Blue” for “colour”");
    expect(answerLabel("list", "tools", ["Saw", "Drill"])).toBe("pick 2 choices for “tools”");
    expect(answerLabel("choice", "shift", [])).toBe("clear “shift”");
    expect(fieldLabel("a.b.c")).toBe("c");
  });

  it("takes Claude's answers in the forms people would give them", () => {
    expect(answerFor(field({ kind: "tick" }), "yes")).toEqual({ value: true });
    expect(answerFor(field({ kind: "tick" }), false)).toEqual({ value: false });
    expect(answerFor(field({ kind: "tick" }), "maybe")).toHaveProperty("problem");
    expect(answerFor(field({ kind: "text" }), 42)).toEqual({ value: "42" });
    expect(answerFor(field({ kind: "radio", options: ["Red", "Blue"] }), "blue")).toEqual({ value: "Blue" });
    expect(answerFor(field({ kind: "radio", options: ["Red", "Blue"] }), "Green")).toHaveProperty("problem");
    expect(answerFor(field({ kind: "list", options: ["A", "B"] }), ["a", "B"])).toEqual({ value: ["A", "B"] });
    expect(answerFor(field({ kind: "text", readOnly: true }), "x")).toHaveProperty("problem");
    expect(answerFor(field({ kind: "signature" }), "x")).toHaveProperty("problem");
  });

  it("compares answers, lists in any order", () => {
    expect(sameValue(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameValue([], "")).toBe(true);
    expect(sameValue("a", "b")).toBe(false);
    expect(sameValue(true, true)).toBe(true);
  });

  it("goes through boxes row by row, page by page", () => {
    const order = tabOrder([
      { id: "b", page: 0, x: 200, y: 101, height: 20 },
      { id: "c", page: 0, x: 10, y: 200, height: 20 },
      { id: "a", page: 0, x: 10, y: 100, height: 20 },
      { id: "d", page: 1, x: 10, y: 10, height: 20 },
    ]);
    expect(order.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("sizes typed words to the box", () => {
    expect(fitFontSize({ height: 20, fontSize: 9 })).toBe(9);
    expect(fitFontSize({ height: 20 })).toBe(12);
    expect(fitFontSize({ height: 60, multiline: true })).toBe(10);
  });
});

describe("dates", () => {
  it("reads the way a box writes dates from its instructions", () => {
    expect(dateFormatIn('AFDate_FormatEx("dd/mm/yyyy");')).toBe("dd/mm/yyyy");
    expect(dateFormatIn("AFDate_KeystrokeEx('mmm d, yyyy')")).toBe("mmm d, yyyy");
    expect(dateFormatIn("AFDate_FormatEx (\"yyyy-mm-dd\")")).toBe("yyyy-mm-dd");
    expect(dateFormatIn("AFDate_Format(2)")).toBe("mm/dd/yy");
    expect(dateFormatIn('AFNumber_Format(2, 0, 0, 0, "", true);')).toBeUndefined();
    expect(dateFormatIn(undefined)).toBeUndefined();
  });

  it("writes and reads dates in each way", () => {
    expect(writeDate(2026, 3, 7, "dd/mm/yyyy")).toBe("07/03/2026");
    expect(writeDate(2026, 3, 7, "mm/dd/yyyy")).toBe("03/07/2026");
    expect(writeDate(2026, 3, 7, "d mmmm yyyy")).toBe("7 March 2026");
    expect(writeDate(2026, 3, 7, "mmmm d, yyyy")).toBe("March 7, 2026");
    expect(writeDate(2026, 3, 7, "dd-mmm-yy")).toBe("07-Mar-26");
    for (const f of DATE_FORMATS) expect(readDate(writeDate(2026, 11, 28, f), f)).toEqual([2026, 11, 28]);
    expect(readDate("2026-02-30", "dd/mm/yyyy")).toBeNull();
    expect(readDate("31/04/2026", "dd/mm/yyyy")).toBeNull();
    expect(readDate("soon", "dd/mm/yyyy")).toBeNull();
    expect(dateForBox("2026-11-28", "d mmmm yyyy")).toBe("28 November 2026");
    expect(dateForBox("28 nov 2026", "d mmmm yyyy")).toBe("28 November 2026");
    expect(dateForBox("", "dd/mm/yyyy")).toBe("");
  });

  it("takes dates in a date box from Claude, written the box's way", () => {
    const field: FormFieldInfo = { name: "When", kind: "text", value: "", pages: [0], dateFormat: "dd/mm/yyyy" };
    expect(answerFor(field, "2026-11-28")).toEqual({ value: "28/11/2026" });
    expect(answerFor(field, "tomorrow")).toHaveProperty("problem");
  });
});

describe("adding round buttons and date boxes", () => {
  const round = (option: string, y: number, name = "Size"): FieldItem => ({ kind: "field", field: "round", page: 0, x: 50, y, width: 14, height: 14, name, option });
  it("makes a set of round buttons to pick one from, and a date box Acrobat knows", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    let bytes: Uint8Array = await doc.save();
    bytes = await addItems(bytes, [round("Small", 50)]);
    bytes = await addItems(bytes, [round("Large", 80)]);
    bytes = await addItems(bytes, [round("Small", 110)]);
    bytes = await addItems(bytes, [{ kind: "field", field: "date", page: 0, x: 100, y: 50, width: 120, height: 22, name: "When", dateFormat: "d mmmm yyyy" }]);
    const fields = await formFields(bytes);
    expect(fields.map((f) => [f.name, f.kind, f.options, f.dateFormat])).toEqual([
      ["Size", "radio", ["Small", "Large", "Option 1"], undefined],
      ["When", "text", undefined, "d mmmm yyyy"],
    ]);
    const kept = (await keptIn(bytes))[0];
    expect(kept.map((k) => (k.item as FieldItem).option ?? (k.item as FieldItem).dateFormat)).toEqual(["Small", "Large", "Option 1", "d mmmm yyyy"]);
    const boxes = await boxesOn(bytes, 1);
    expect(boxes.filter((b) => b.kind === "radio")).toHaveLength(3);
    expect(boxes.find((b) => b.name === "When")?.dateFormat).toBe("d mmmm yyyy");

    // Picking one, then moving another: the set keeps all three buttons.
    bytes = await fillForm(bytes, [{ name: "Size", value: "Large" }]);
    const large = kept.find((k) => (k.item as FieldItem).option === "Large")!;
    bytes = await changeItem(bytes, 0, large.id, { ...(large.item as FieldItem), y: 200 });
    const size = async () => (await formFields(bytes)).find((f) => f.name === "Size");
    expect((await size())?.options?.sort()).toEqual(["Large", "Option 1", "Small"]);
    const radios = (await boxesOn(bytes, 1)).filter((b) => b.kind === "radio");
    expect(radios.map((b) => Math.round(b.y)).sort((a, b) => a - b)).toEqual([50, 110, 200]);
    // Taking one off leaves the other two.
    const third = (await keptIn(bytes))[0].find((k) => (k.item as FieldItem).option === "Option 1")!;
    bytes = await changeItem(bytes, 0, third.id, null);
    expect((await size())?.options?.sort()).toEqual(["Large", "Small"]);
    expect((await boxesOn(bytes, 1)).filter((b) => b.kind === "radio")).toHaveLength(2);
  });
});

describe("adding list boxes and boxes that must be filled in", () => {
  it("makes a list box showing every choice, where several can be picked, and marks boxes as needed", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    let bytes: Uint8Array = await doc.save();
    const list: FieldItem = { kind: "field", field: "list", page: 0, x: 50, y: 50, width: 150, height: 60, name: "Tools", choices: ["Hammer", "Saw", "Drill"], several: true, required: true };
    bytes = await addItems(bytes, [list]);
    bytes = await addItems(bytes, [{ kind: "field", field: "text", page: 0, x: 50, y: 150, width: 150, height: 22, name: "Who", required: true }]);
    bytes = await addItems(bytes, [{ kind: "field", field: "tick", page: 0, x: 50, y: 200, width: 14, height: 14, name: "Maybe" }]);
    const fields = await formFields(bytes);
    expect(fields.map((f) => [f.name, f.kind, f.options, f.required])).toEqual([
      ["Tools", "list", ["Hammer", "Saw", "Drill"], true],
      ["Who", "text", undefined, true],
      ["Maybe", "tick", undefined, undefined],
    ]);
    const boxes = await boxesOn(bytes, 1);
    const tools = boxes.find((b) => b.name === "Tools")!;
    expect(tools).toMatchObject({ kind: "list", several: true, required: true });
    expect(Math.abs(tools.y - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(tools.height - 60)).toBeLessThanOrEqual(1);
    expect(boxes.find((b) => b.name === "Who")?.required).toBe(true);
    expect(boxes.find((b) => b.name === "Maybe")?.required).toBeUndefined();
    bytes = await fillForm(bytes, [{ name: "Tools", value: ["Saw", "Drill"] }]);
    expect((await formFields(bytes))[0].value).toEqual(["Saw", "Drill"]);
    // Changing it keeps what it is: one pick only now.
    const [kept] = (await keptIn(bytes))[0];
    expect(kept.item).toMatchObject({ field: "list", several: true, required: true });
    bytes = await changeItem(bytes, 0, kept.id, { ...(kept.item as FieldItem), several: false, required: false });
    expect((await boxesOn(bytes, 1)).find((b) => b.name === "Tools")).toMatchObject({ kind: "list", several: undefined, required: undefined });
  });

  it("turns away a list box with no choices", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    await expect(addItems(await doc.save(), [{ kind: "field", field: "list", page: 0, x: 50, y: 50, width: 150, height: 60, name: "Empty", choices: [] }])).rejects.toThrow(/choices/);
  });
});

describe("signature boxes", () => {
  it("makes a box to sign in that readers know, see-through inside, and takes it off again", async () => {
    for (const turn of [0, 90]) {
      const doc = await PDFDocument.create();
      const p = doc.addPage([400, 500]);
      if (turn) p.setRotation(degrees(turn));
      let bytes: Uint8Array = await doc.save();
      bytes = await addItems(bytes, [{ kind: "field", field: "signature", page: 0, x: 60, y: 80, width: 180, height: 40, name: "Signed by", required: true }]);
      const fields = await formFields(bytes);
      expect(fields).toMatchObject([{ name: "Signed by", kind: "signature", required: true, pages: [0] }]);
      const [box] = await boxesOn(bytes, 1);
      expect(box).toMatchObject({ kind: "signature", name: "Signed by", required: true });
      expect(Math.abs(box.x - 60)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.y - 80)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - 180)).toBeLessThanOrEqual(1);
      // Nothing white inside, so a signature put in it shows.
      const loaded = await PDFDocument.load(bytes);
      const widget = loaded.getForm().getFields()[0].acroField.getWidgets()[0];
      expect(widget.getAppearanceCharacteristics()?.getBackgroundColor()).toBeUndefined();
      // Taken off again.
      const [kept] = (await keptIn(bytes))[0];
      bytes = await changeItem(bytes, 0, kept.id, null);
      expect(await formFields(bytes)).toEqual([]);
      expect(await boxesOn(bytes, 1)).toEqual([]);
    }
  });

  it("puts a signature in a box as large as fits, in the middle", () => {
    expect(fitInBox(400, 100, { x: 10, y: 20, width: 180, height: 40 })).toEqual({ x: 28, y: 22, width: 144, height: 36 });
  });
});

describe("dates typed loosely", () => {
  it("takes numbers in the format's order of day and month", () => {
    expect(dateForBox("3/4/2026", "d mmmm yyyy")).toBe("3 April 2026");
    expect(dateForBox("3.4.26", "dd/mm/yyyy")).toBe("03/04/2026");
    expect(dateForBox("3/4/2026", "mmmm d, yyyy")).toBe("March 4, 2026");
    expect(dateForBox("3 4 2026", "yyyy-mm-dd")).toBe("2026-03-04");
  });
});

describe("new form boxes on turned pages", () => {
  for (const turn of [90, 180, 270]) {
    it(`lands round buttons and date boxes where they were put, turned ${turn}`, async () => {
      const doc = await PDFDocument.create();
      doc.addPage([400, 600]).setRotation(degrees(turn));
      let bytes: Uint8Array = await doc.save();
      bytes = await addItems(bytes, [{ kind: "field", field: "round", page: 0, x: 50, y: 60, width: 14, height: 14, name: "Pick", option: "A" }]);
      bytes = await addItems(bytes, [{ kind: "field", field: "date", page: 0, x: 100, y: 120, width: 120, height: 22, name: "When", dateFormat: "dd/mm/yyyy" }]);
      const boxes = await boxesOn(bytes, 1);
      const at = (name: string) => boxes.find((b) => b.name === name)!;
      // (Within a point: pdf-lib rounds a round button's box a little.)
      const near = (b: { x: number; y: number; width: number; height: number }, want: number[]) => [b.x, b.y, b.width, b.height].forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(1.01));
      near(at("Pick"), [50, 60, 14, 14]);
      near(at("When"), [100, 120, 120, 22]);
    });
  }
});
