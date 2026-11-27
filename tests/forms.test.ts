import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { answerFor, answerLabel, fieldLabel, fitFontSize, formBoxesFrom, sameValue, tabOrder, type FormFieldInfo } from "../src/model/forms";
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
