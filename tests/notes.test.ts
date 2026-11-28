import { describe, expect, it } from "vitest";
import { PDFDocument, PDFHexString, PDFName, PDFString, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { colourCss, colourFrom, inReadingOrder, notePlace, noteSummary, notesCount, pdfDate, readPdfDate, whenLabel, withReplies, type Note } from "../src/model/notes";
import { fromPageSpace, toPageSpace } from "../src/model/watermark";
import { addNote, addNotes, changeNote, listNotes, NoteProblem, removeNote } from "../src/pdf/notes";

async function blank(turn = 0, pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([400, 600]);
    if (turn) p.setRotation(degrees(turn));
  }
  return doc.save();
}

const read = async (bytes: Uint8Array) => listNotes(await PDFDocument.load(bytes));

describe("dates", () => {
  it("writes and reads PDF dates", () => {
    const d = new Date(Date.UTC(2026, 10, 27, 14, 5, 9));
    expect(pdfDate(d)).toBe("D:20261127140509Z");
    expect(readPdfDate("D:20261127140509Z")?.getTime()).toBe(d.getTime());
    expect(readPdfDate("D:20261127150509+01'00'")?.getTime()).toBe(d.getTime());
    expect(readPdfDate("D:20261127090509-05'00")?.getTime()).toBe(d.getTime());
    expect(readPdfDate("D:2026")?.getTime()).toBe(Date.UTC(2026, 0, 1));
    expect(readPdfDate("yesterday")).toBeNull();
    expect(whenLabel("nope")).toBe("");
    expect(whenLabel("D:20261127140509Z", "en-GB")).toContain("2026");
  });
});

describe("notes (pure)", () => {
  it("colours", () => {
    expect(colourCss([1, 0.82, 0.2])).toBe("#ffd133");
    expect(colourFrom([0.5])).toEqual([0.5, 0.5, 0.5]);
    expect(colourFrom([0, 0, 0, 1])).toEqual([0, 0, 0]);
    expect(colourFrom([])).toBeNull();
  });

  it("places a new note inside the page, centred on the click", () => {
    expect(notePlace(100, 100, 400, 600)).toEqual({ x: 89, y: 89 });
    expect(notePlace(2, 599, 400, 600)).toEqual({ x: 0, y: 578 });
  });

  it("summaries, counts and order", () => {
    expect(noteSummary("  Check   this\nfigure ")).toBe("Check this figure");
    expect(noteSummary("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
    expect(notesCount(1)).toBe("1 note");
    expect(notesCount(2)).toBe("2 notes");
    const n = (id: string, page: number, y: number, x = 0) => ({ id, page, y, x }) as Note;
    expect(inReadingOrder([n("c", 1, 0), n("b", 0, 50), n("a", 0, 10, 5), n("a0", 0, 10, 1)]).map((x) => x.id)).toEqual(["a0", "a", "b", "c"]);
  });

  it("puts replies under the note they answer, even replies to replies", () => {
    const base = { page: 0, x: 0, y: 0, width: 20, height: 20, author: "A", colour: [1, 1, 0] as [number, number, number], replies: [] };
    const out = withReplies([
      { ...base, id: "1R", text: "Top", when: "" },
      { ...base, id: "3R", text: "Second", when: "D:20261102", inReplyTo: "2R" },
      { ...base, id: "2R", text: "First", when: "D:20261101", inReplyTo: "1R" },
      { ...base, id: "9R", text: "Orphan", when: "", inReplyTo: "8R" },
      { ...base, id: "5R", text: "Loop a", when: "", inReplyTo: "6R" },
      { ...base, id: "6R", text: "Loop b", when: "", inReplyTo: "5R" },
    ]);
    expect(out.map((n) => n.id)).toEqual(["1R", "9R", "5R", "6R"]);
    expect(out[0].replies.map((r) => r.text)).toEqual(["First", "Second"]);
    expect("inReplyTo" in out[0]).toBe(false);
  });

  it("turns points to the page's space and back", () => {
    for (const rotation of [0, 90, 180, 270]) {
      const f = { x: 10, y: 20, width: 400, height: 600, rotation };
      const p = toPageSpace(f, 33, 44, 0);
      expect(fromPageSpace(f, p.x, p.y)).toEqual({ x: 33, y: 44 });
    }
  });
});

describe("notes in the PDF", () => {
  it("adds a note that pdf.js reads back as a comment, where it was put", async () => {
    const { bytes, id } = await addNote(await blank(), { page: 1, x: 100, y: 50, text: "Check this figure — €5", author: "Kevin", colour: [0.45, 0.7, 1] }, new Date(Date.UTC(2026, 10, 27)));
    expect(id).toMatch(/^\d+R$/);
    const notes = await read(bytes);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id, page: 1, x: 100, y: 50, width: 22, height: 22, text: "Check this figure — €5", author: "Kevin", when: "D:20261127000000Z", replies: [] });
    expect(notes[0].colour.map((c) => Math.round(c * 100))).toEqual([45, 70, 100]);

    const pdf = await getDocument({ data: bytes, verbosity: 0 }).promise;
    const annots = await (await pdf.getPage(2)).getAnnotations();
    expect(annots).toHaveLength(1);
    expect(annots[0]).toMatchObject({ subtype: "Text", contentsObj: { str: "Check this figure — €5" }, titleObj: { str: "Kevin" } });
    // 600 high: 50 down from the top is 550 up; the icon hangs from there.
    expect(Array.from(annots[0].rect as number[])).toEqual([100, 528, 122, 550]);
  });

  it("adds several notes in one go", async () => {
    const bytes = await addNotes(await blank(), [
      { page: 0, x: 10, y: 10, text: "One" },
      { page: 1, x: 20, y: 30, text: "Two", author: "Compare" },
    ]);
    const notes = await read(bytes);
    expect(notes.map((n) => [n.page, n.x, n.y, n.text, n.author])).toEqual([
      [0, 10, 10, "One", ""],
      [1, 20, 30, "Two", "Compare"],
    ]);
    await expect(addNotes(bytes, [{ page: 9, x: 0, y: 0, text: "Nowhere" }])).rejects.toThrow(/no page 10/);
  });

  it("keeps a note's place on turned pages", async () => {
    for (const turn of [90, 180, 270]) {
      const { bytes } = await addNote(await blank(turn, 1), { page: 0, x: 120, y: 40, text: "Here" });
      const [n] = await read(bytes);
      expect([turn, Math.round(n.x), Math.round(n.y)]).toEqual([turn, 120, 40]);
    }
  });

  it("keeps a note inside the page", async () => {
    const { bytes } = await addNote(await blank(), { page: 0, x: 395, y: -10, text: "Edge" });
    expect(await read(bytes)).toMatchObject([{ x: 378, y: 0 }]);
  });

  it("changes a note's words, colour and place", async () => {
    const first = await addNote(await blank(), { page: 0, x: 10, y: 10, text: "One" });
    const changed = await changeNote(first.bytes, first.id, { text: "Two\nlines", colour: [1, 0.55, 0.75], x: 200, y: 300 });
    const [n] = await read(changed);
    expect(n).toMatchObject({ id: first.id, text: "Two\nlines", x: 200, y: 300 });
    expect(n.colour[0]).toBe(1);
  });

  it("takes a note away with its replies and pop-up, leaving the others", async () => {
    const a = await addNote(await blank(), { page: 0, x: 10, y: 10, text: "Keep" });
    const b = await addNote(a.bytes, { page: 0, x: 50, y: 50, text: "Remove" });
    // Another reader's reply to the second, with a pop-up window.
    const doc = await PDFDocument.load(b.bytes);
    const page = doc.getPage(0);
    const parent = listNotes(doc).find((n) => n.text === "Remove")!;
    const parentRef = page.node.Annots()!.get(1);
    const reply = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: [50, 530, 70, 550], Contents: PDFHexString.fromText("A reply"), T: PDFString.of("Sam"), IRT: parentRef }));
    const popup = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Popup", Rect: [80, 400, 200, 500], Parent: parentRef }));
    page.node.addAnnot(reply);
    page.node.addAnnot(popup);
    (doc.context.lookup(parentRef) as import("pdf-lib").PDFDict).set(PDFName.of("Popup"), popup);
    const withReply = await doc.save();
    const listed = await read(withReply);
    expect(listed.map((n) => n.text)).toEqual(["Keep", "Remove"]);
    expect(listed[1].replies).toMatchObject([{ text: "A reply", author: "Sam" }]);
    expect(parent.id).toBe(b.id);

    const after = await removeNote(withReply, b.id);
    expect((await read(after)).map((n) => n.text)).toEqual(["Keep"]);
    expect((await PDFDocument.load(after)).getPage(0).node.Annots()!.size()).toBe(1);
  });

  it("says kindly when a note has gone", async () => {
    await expect(removeNote(await blank(), "99R")).rejects.toBeInstanceOf(NoteProblem);
    await expect(addNote(await blank(), { page: 5, x: 0, y: 0, text: "x" })).rejects.toThrow("There's no page 6.");
  });

  it("doesn't list hidden notes", async () => {
    const { bytes, id } = await addNote(await blank(), { page: 0, x: 10, y: 10, text: "Hidden" });
    const doc = await PDFDocument.load(bytes);
    (doc.getPage(0).node.Annots()!.lookup(0) as import("pdf-lib").PDFDict).set(PDFName.of("F"), doc.context.obj(2));
    expect(id).toBeTruthy();
    expect(listNotes(doc)).toEqual([]);
  });
});
