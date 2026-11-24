/**
 * Claude's tools (src/mcp/tools.ts), on a session of their own: reading a PDF,
 * changing its pages, watermarks, the checks on what's given, saving and
 * opening files — only inside the chosen folder.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { PdfFolder } from "../src/mcp/files";
import { pageWords } from "../src/mcp/reading";
import { Session } from "../src/mcp/session";
import { callTool, FORMAT_GUIDE, pagesOf, TOOLS, type ToolResult } from "../src/mcp/tools";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

/** A PDF of A4 pages, each saying "<name> page N". */
async function pdfOf(name: string, count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i++) doc.addPage([595, 842]).drawText(`${name} page ${i}`, { x: 60, y: 760, size: 24, font });
  return doc.save();
}

async function session(files: Record<string, Uint8Array> = {}) {
  const root = mkdtempSync(join(tmpdir(), "jurapdf-mcp-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "JuraPDF");
  const s = new Session(new PdfFolder(dir));
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
  return { dir, s };
}
const textOf = (r: ToolResult) => r.content.map((c) => c.text).join("\n");
async function ok(s: Session, name: string, args: unknown = {}) {
  const r = await callTool(s, name, args);
  if (r.isError) throw new Error(`${name} failed: ${textOf(r)}`);
  return textOf(r);
}
async function bad(s: Session, name: string, args: unknown = {}) {
  const before = s.doc;
  const r = await callTool(s, name, args);
  expect(r.isError, `${name} should be refused`).toBe(true);
  expect(s.doc, `${name}: a refused call changes nothing`).toBe(before);
  return textOf(r);
}
/** The words of every page of the PDF being worked on. */
async function words(s: Session): Promise<string[]> {
  const count = (await PDFDocument.load(s.doc!.bytes)).getPageCount();
  return pageWords(s.doc!.bytes, Array.from({ length: count }, (_, i) => i));
}

describe("the tool list", () => {
  it("has a name, title, description and schema for each", () => {
    expect(TOOLS.length).toBeGreaterThan(12);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe("object");
      for (const key of t.inputSchema.required ?? []) expect(Object.keys(t.inputSchema.properties)).toContain(key);
      // The guide names every tool that changes something.
      if (!t.readOnly && !["save_pdf", "new_pdf", "open_pdf"].includes(t.name)) expect(FORMAT_GUIDE).toContain(t.name);
    }
  });
});

describe("page numbers", () => {
  it("reads numbers, lists, ranges and words, from 1 as the user counts", () => {
    expect(pagesOf(2, 5, "p")).toEqual([1]);
    expect(pagesOf([3, 1, 3], 5, "p")).toEqual([0, 2]);
    expect(pagesOf("1-3, 5", 5, "p")).toEqual([0, 1, 2, 4]);
    expect(pagesOf("4-", 5, "p")).toEqual([3, 4]);
    expect(pagesOf("all", 3, "p")).toEqual([0, 1, 2]);
    expect(pagesOf("odd", 5, "p")).toEqual([0, 2, 4]);
    expect(pagesOf("even", 5, "p")).toEqual([1, 3]);
    expect(pagesOf("last", 5, "p")).toEqual([4]);
    expect(() => pagesOf(9, 5, "p")).toThrow(/no page 9/);
    expect(() => pagesOf("even", 1, "p")).toThrow(/only one page/);
    expect(() => pagesOf("two", 5, "p")).toThrow(/isn't a page number/);
    expect(() => pagesOf(undefined, 5, "p")).toThrow(/missing/);
  });
});

describe("reading and changing a PDF", () => {
  it("opens a PDF from the folder and says what's on its pages", async () => {
    const { s } = await session({ "Report.pdf": await pdfOf("Report", 3) });
    expect(await bad(s, "describe_pdf")).toMatch(/No PDF is open yet/);
    const opened = await ok(s, "open_pdf", { filename: "Report" });
    expect(opened).toMatch(/Report\.pdf: 3 pages/);
    expect(opened).toMatch(/Pages 1-3: A4 \(portrait\)/);
    expect(opened).toMatch(/Page 2: Report page 2/);
    expect(await ok(s, "read_words", { pages: "2-3" })).toBe("--- Page 2 ---\nReport page 2\n--- Page 3 ---\nReport page 3");
  });

  it("turns, moves, deletes and adds pages, joins another PDF, and undoes", async () => {
    const { s } = await session({ "Report.pdf": await pdfOf("Report", 3), "Extra.pdf": await pdfOf("Extra", 2) });
    await ok(s, "open_pdf", { filename: "Report.pdf" });
    expect(await ok(s, "turn_pages", { pages: "1, 3", direction: "right" })).toBe("Turned pages 1 and 3 a quarter turn clockwise.");
    expect(await ok(s, "describe_pdf", { words: false })).toMatch(/Page 1: A4 landscape, turned 90°\n- Page 2: A4 \(portrait\)\n- Page 3: A4 landscape, turned 90°/);
    expect(await ok(s, "move_pages", { pages: 3, before: 1 })).toMatch(/Moved page 3: it's now page 1/);
    expect(await words(s)).toEqual(["Report page 3", "Report page 1", "Report page 2"]);
    expect(await ok(s, "move_pages", { pages: 1, before: "end" })).toMatch(/now page 3/);
    expect(await words(s)).toEqual(["Report page 1", "Report page 2", "Report page 3"]);
    expect(await ok(s, "move_pages", { pages: 1, before: 1 })).toMatch(/already there/);
    expect(await ok(s, "bring_in_pdf", { filename: "Extra", after: 1 })).toMatch(/Brought in 2 pages from Extra\.pdf after page 1: now pages 2-3\. The PDF has 5 pages/);
    expect(await words(s)).toEqual(["Report page 1", "Extra page 1", "Extra page 2", "Report page 2", "Report page 3"]);
    expect(await ok(s, "add_blank_pages", { after: 0, count: 2 })).toMatch(/Added 2 blank pages at the start: pages 1-2/);
    expect((await words(s)).slice(0, 3)).toEqual(["", "", "Report page 1"]);
    expect(await ok(s, "delete_pages", { pages: "1-2" })).toMatch(/Deleted pages 1 and 2\. The PDF now has 5 pages/);
    expect(await bad(s, "delete_pages", { pages: "all" })).toMatch(/at least one page/);
    expect(await ok(s, "undo")).toBe('Took back: deleted pages 1 and 2.');
    expect(await words(s)).toHaveLength(7);
    await ok(s, "undo");
    await ok(s, "undo");
    expect(await words(s)).toEqual(["Report page 1", "Report page 2", "Report page 3"]);
  });

  it("adds a watermark of words or of a picture, on chosen pages", async () => {
    const { s, dir } = await session({ "Report.pdf": await pdfOf("Report", 3) });
    await ok(s, "open_pdf", { filename: "Report" });
    expect(await ok(s, "add_watermark", { words: "CI DRAFT", colour: "blue", pages: "odd", see_through: 50 })).toBe('Added the "CI DRAFT" watermark to pages 1 and 3.');
    const w = await words(s);
    expect(w[0]).toContain("CI DRAFT");
    expect(w[1]).not.toContain("CI DRAFT");
    expect(await bad(s, "add_watermark", {})).toMatch(/either "words" or "picture"/);
    expect(await bad(s, "add_watermark", { words: "x", colour: "tartan" })).toMatch(/colour/);
    expect(await bad(s, "add_watermark", { words: "x", placement: "under" })).toMatch(/placement must be one of/);
    expect(await bad(s, "add_watermark", { words: "x", sizes: 3 })).toMatch(/"sizes" isn't a setting/);
    expect(await bad(s, "add_watermark", { words: "日本" })).toMatch(/./);
    // A 1×1 PNG from the folder.
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360f8cfc0000003010100c9fe92ef0000000049454e44ae426082", "hex");
    writeFileSync(join(dir, "logo.png"), png);
    expect(await ok(s, "list_pdfs")).toMatch(/Pictures \(for add_watermark\):\n- logo\.png/);
    expect(await ok(s, "add_watermark", { picture: "logo.png", placement: "top-right", picture_width: 20, pages: 2 })).toBe("Added the logo.png watermark to page 2.");
    expect(await bad(s, "add_watermark", { picture: "missing.png" })).toMatch(/no file called/);
  });

  it("starts a new PDF, and says what's wrong in words", async () => {
    const { s } = await session();
    expect(await ok(s, "new_pdf", { name: "Notes", pages: 2, size: "Letter", landscape: true })).toBe("Started Notes.pdf: 2 blank Letter landscape pages.");
    expect(await ok(s, "describe_pdf", { words: false })).toMatch(/Pages 1-2: Letter landscape/);
    expect(await bad(s, "turn_pages", { pages: 1, direction: "sideways" })).toMatch(/direction must be one of "right", "left", "half"/);
    expect(await bad(s, "turn_pages", { pages: 3, direction: "left" })).toMatch(/no page 3/);
    expect(await bad(s, "add_blank_pages", { after: 9 })).toMatch(/after must be a number from 0 to 2/);
    expect(await bad(s, "new_pdf", { pages: 0 })).toMatch(/pages must be a number from 1 to 200/);
    expect(await bad(s, "no_such_tool")).toMatch(/no tool called/);
  });
});

describe("files", () => {
  it("saves, lists and opens — only inside its folder", async () => {
    const { s, dir } = await session({ "Report.pdf": await pdfOf("Report", 3) });
    await ok(s, "open_pdf", { filename: "Report" });
    await ok(s, "delete_pages", { pages: 2 });
    // Saving again to its own file needs no asking; another file is not replaced unasked.
    expect(await ok(s, "save_pdf")).toMatch(/Saved Report\.pdf/);
    expect((await PDFDocument.load(readFileSync(join(dir, "Report.pdf")))).getPageCount()).toBe(2);
    expect(await bad(s, "save_pdf", { filename: "../escape" })).toMatch(/plain file name/);
    expect(await bad(s, "save_pdf", { filename: "C:\\x" })).toMatch(/plain file name/);
    writeFileSync(join(dir, "other.pdf"), await pdfOf("Other", 1));
    expect(await bad(s, "save_pdf", { filename: "other" })).toMatch(/already a file/);
    await ok(s, "save_pdf", { filename: "other", overwrite: true });
    expect(await ok(s, "save_pages_as_pdf", { pages: 2, filename: "Just page 2" })).toMatch(/Saved page 2 as Just page 2\.pdf/);
    expect(await pageWords(new Uint8Array(readFileSync(join(dir, "Just page 2.pdf"))), [0])).toEqual(["Report page 3"]);
    expect(await ok(s, "list_pdfs")).toMatch(/- Just page 2\.pdf/);
    expect(await bad(s, "open_pdf", { filename: "missing" })).toMatch(/no file called/);
    writeFileSync(join(dir, "broken.pdf"), "not a PDF");
    expect(await bad(s, "open_pdf", { filename: "broken" })).toMatch(/doesn't look like a PDF/);
    expect(await bad(s, "bring_in_pdf", { filename: "notes.txt" })).toMatch(/should end in \.pdf/);
    try {
      symlinkSync(join(dir, "..", "outside.pdf"), join(dir, "link.pdf"));
      writeFileSync(join(dir, "..", "outside.pdf"), await pdfOf("Outside", 1));
      expect(await bad(s, "open_pdf", { filename: "link" })).toMatch(/shortcut/);
    } catch (e) {
      // (No links on this file system: nothing to check.)
      if (!(e instanceof Error) || !/EPERM|ENOSYS/.test(e.message)) throw e;
    }
    expect(readdirSync(dir).some((n) => n.endsWith(".saving"))).toBe(false);
  });

  it("can read a locked PDF but not change it", async () => {
    // A PDF with an /Encrypt entry in its trailer is treated as locked by pdf-lib.
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const plain = Buffer.from(await doc.save({ useObjectStreams: false })).toString("latin1");
    const locked = plain.replace(/trailer\s*<</, "trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 /O (x) /U (x) /P -4 >>");
    expect(locked).not.toBe(plain);
    const { s } = await session({ "Locked.pdf": Buffer.from(locked, "latin1") });
    const opened = await callTool(s, "open_pdf", { filename: "Locked" });
    if (opened.isError) {
      expect(textOf(opened)).toMatch(/locked|password|read/i);
      return;
    }
    expect(textOf(opened)).toMatch(/locked against changes/);
    expect(await bad(s, "turn_pages", { pages: 1, direction: "left" })).toMatch(/locked against changes/);
  });

  it("takes back a cancelled call", async () => {
    const { s } = await session({ "Report.pdf": await pdfOf("Report", 2) });
    await ok(s, "open_pdf", { filename: "Report" });
    const before = s.doc;
    const stop = new AbortController();
    stop.abort();
    const r = await callTool(s, "delete_pages", { pages: 1 }, stop.signal);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Cancelled/);
    expect(s.doc).toBe(before);
  });
});
