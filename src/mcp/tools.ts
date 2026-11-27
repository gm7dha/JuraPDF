/**
 * The tools Claude has for working on PDFs with JuraPDF: each one checks what
 * it's given (plain-English messages when something's wrong), changes the
 * session's PDF with the app's own code (src/pdf/pages.ts, src/pdf/watermark.ts),
 * and says what it did. While a JuraPDF tab is connected (Live with Claude) the
 * same tools work on the PDF open there (src/mcp/live.ts).
 */
import { PDFDocument } from "pdf-lib";

import { pagesLabel } from "../model/pages";
import { looksLikePdf, paperName, PDF_EXTENSION, sizeLabel } from "../model/pdfFile";
import { parsePageRange } from "../model/printMark";
import { DEFAULT_WATERMARK, FONT_NAMES, PLACEMENT_NAMES, type FontChoice, type Placement, type WatermarkSettings } from "../model/watermark";
import { addBlankPage, deletePages, extractPages, insertPdf, PageProblem, reorderPages, turnPages } from "../pdf/pages";
import { addWatermark, LockedPdf, WatermarkProblem, type WatermarkPicture } from "../pdf/watermark";
import { additionLabel, choicesOf, FIELD_SIZE, cleanSize, DEFAULT_WORDS, linesOf, SHAPE_NAMES, SHAPE_STYLE, startingPictureSize, type ShapeKind } from "../model/additions";
import { answerFor, answerLabel, FORM_KIND_NAMES, type Answer, type FormBoxKind, type FormValue } from "../model/forms";
import { fillForm, formFields, FormProblem } from "../pdf/forms";
import { DEFAULT_HEADERS, dateText, hasWords, headersLabel, type HeaderSettings } from "../model/headers";
import { addHeaders, HeaderProblem, removeHeaders } from "../pdf/headers";
import { inReadingOrder, NOTE_COLOURS, NOTE_SIZE, readPdfDate } from "../model/notes";
import { addNote, listNotes, NoteProblem, removeNote } from "../pdf/notes";
import { squeeze } from "../pdf/compress";
import { AddProblem, addItems, addPicture, addShape, addWords, pictureType } from "../pdf/additions";
import { moveTo, sameOrder } from "../model/pages";
import { InputError, bool, noExtras, num, object, oneOf, text } from "./args";
import { isLocked, pageFacts, pageWords } from "./reading";
import { Cancelled, type PdfDoc, type Session } from "./session";
import { checkFree, fileNameFor, needFolder, say, writeOut, type ToolDef, type ToolResult } from "./toolKit";

export type { ToolDef, ToolResult } from "./toolKit";

/** How PDFs are described to the tools: sent to Claude with the server's instructions, and by the format_guide tool. */
export const FORMAT_GUIDE = `How JuraPDF works with PDFs:
- You work on one PDF at a time. Live with Claude (live_status): when the user's JuraPDF tab is connected, that's the PDF open there, and each change shows there at once as one step in its Undo list. Otherwise open one from the JuraPDF folder (list_pdfs, open_pdf), or start one (new_pdf), and save_pdf when done.
- Pages are numbered from 1, as the user sees them. "pages" takes a number, a list of numbers, or text like "1-3, 5", "4-" (4 to the end), "all", "odd", "even" or "last".
- Sizes are paper names (A4, Letter…) or millimetres; "landscape" means wider than tall. A page's "turn" is how it has been rotated to show (0, 90, 180 or 270 degrees clockwise).
- describe_pdf gives the pages and a taste of their words; read_words gives the words of chosen pages (scanned pages, being pictures, have none).
- Changes: add_watermark (words or a PNG/JPG picture from the folder, saved into the pages), add_words and add_picture (writing or a PNG/JPG picture such as a signature on one page, placed in points from its top-left corner as it shows; describe_pdf gives the page sizes), add_shape (a see-through highlight over words, or a box, oval, line or arrow to point something out, a box or oval filled in if wanted; read_words gives where words are), add_form_box (a text box, tick box or choice list that whoever opens the PDF can fill in, e.g. to make a printed form fillable), fill_form (fill in the PDF's form boxes; read_form lists them with what's in them), add_headers (page numbers, Bates numbers or words along the top and bottom of pages), add_note (a sticky note, a comment pinned to a page; read_notes lists the notes and their replies, delete_note takes one off), tidy_pdf (a little smaller, looking the same), turn_pages, delete_pages (one page must stay), move_pages, add_blank_pages, bring_in_pdf (all the pages of another PDF from the folder: this is how to join PDFs), save_pages_as_pdf (some pages as a new PDF in the folder: this is how to split one). undo takes back your last change.
- Locked PDFs (with a password or protected against changes) can be read but not changed.
- Talk to the user in plain words: "pages", "words", "picture", "see-through" — not PDF jargon.`;

const COLOURS: Record<string, string> = { red: "#d1373a", grey: "#808080", gray: "#808080", blue: "#1f5fbf", black: "#000000", green: "#2e8b3a", orange: "#e07b00" };
const SIZES: Record<string, [number, number]> = { A4: [595.28, 841.89], A3: [841.89, 1190.55], A5: [419.53, 595.28], Letter: [612, 792], Legal: [612, 1008] };
const MOST_WORDS = 60_000;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function liveLine(s: Session): string {
  return s.live ? s.live.status().text : "Live: not available in this copy of the extension. save_pdf saves the PDF in the JuraPDF folder to open in JuraPDF.";
}

/** The PDF being worked on, or a kind message saying how to get one. */
function needDoc(s: Session): PdfDoc {
  if (s.doc) return s.doc;
  throw new InputError(
    s.live?.connected
      ? "JuraPDF is connected but has no PDF open. Ask the user to open one there."
      : "No PDF is open yet. Use open_pdf (list_pdfs shows the PDFs in the JuraPDF folder) or new_pdf, or ask the user to connect their JuraPDF tab (live_status says how).",
  );
}

/** Page numbers Claude gave (from 1) as page indexes (from 0), in order, no repeats. */
export function pagesOf(v: unknown, count: number, where: string): number[] {
  if (v === undefined || v === null || v === "") throw new InputError(`${where} is missing: give page numbers, e.g. 2, [1, 3] or "1-3, 5".`);
  let words: string;
  if (typeof v === "number") words = String(v);
  else if (Array.isArray(v)) {
    words = v
      .map((p) => {
        if (typeof p === "number" && Number.isInteger(p)) return String(p);
        if (typeof p === "string" && p.trim()) return p.trim();
        throw new InputError(`${where}: ${JSON.stringify(p)} isn't a page number.`);
      })
      .join(", ");
  } else if (typeof v === "string") words = v;
  else throw new InputError(`${where} should be page numbers, e.g. 2, [1, 3] or "1-3, 5".`);
  const all = Array.from({ length: count }, (_, i) => i);
  const t = words.trim().toLowerCase();
  if (t === "all") return all;
  if (t === "odd") return all.filter((i) => i % 2 === 0);
  if (t === "even") {
    if (count < 2) throw new InputError("This PDF has only one page, so there are no even pages.");
    return all.filter((i) => i % 2 === 1);
  }
  const r = parsePageRange(t.replace(/\blast\b/g, String(count)), count);
  if ("error" in r) throw new InputError(`${where}: ${r.error}`);
  if (!r.pages.length) throw new InputError(`${where}: no pages given.`);
  return r.pages.map((p) => p - 1);
}

/** A page number (from 1) something goes after: 0 = the start, "end" = after the last. */
function placeOf(v: unknown, count: number, where: string): number {
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "start" || t === "beginning") return 0;
    if (t === "end" || t === "last") return count;
  }
  return num(v, where, { min: 0, max: count, integer: true });
}

/** Where moved pages go: just before page N (from 1; count + 1 = the end), "start" or "end". As an index, count = the end. */
function beforeOf(v: unknown, count: number): number {
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "start" || t === "beginning") return 0;
    if (t === "end" || t === "last") return count;
  }
  return num(v, "before", { min: 1, max: count + 1, integer: true }) - 1;
}

/** A colour by name or "#rrggbb". */
function colourOf(v: unknown): string {
  if (v === undefined || v === null) return DEFAULT_WATERMARK.colour;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (COLOURS[t]) return COLOURS[t];
    if (/^#[0-9a-f]{6}$/.test(t)) return t;
    if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`;
  }
  throw new InputError(`colour: give ${Object.keys(COLOURS).filter((c) => c !== "gray").join(", ")}, or a colour like "#336699" (got ${JSON.stringify(v)}).`);
}

/** A PNG or JPG picture from the folder. */
function readPicture(folder: ReturnType<typeof needFolder>, path: string): WatermarkPicture {
  const bytes = folder.read(path);
  const name = path.split(/[\\/]/).pop() ?? "picture";
  const type = pictureType(bytes);
  if (!type) throw new InputError(`${name} isn't a PNG or JPG picture inside.`);
  return { bytes, type, name };
}

/** A picture's size in pixels, read from its file. */
function pixelSize(bytes: Uint8Array, type: "png" | "jpg"): { w: number; h: number } {
  if (type === "png") {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: v.getUint32(16), h: v.getUint32(20) };
  }
  // JPG: the first "start of frame" block holds the size.
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + len;
  }
  return { w: 100, h: 100 };
}

/** Words for a change of the PDF, for Claude and the user's Undo list. */
async function describeDoc(doc: PdfDoc, opts: { words?: boolean } = {}): Promise<string> {
  const facts = await pageFacts(doc.bytes);
  const locked = await isLocked(doc.bytes);
  const lines = [`${doc.name}: ${plural(facts.length, "page")}, ${sizeLabel(doc.bytes.length)}.${locked ? " It's locked against changes (it can be read, not changed)." : ""}`];
  // Runs of pages the same size and turn, so a long PDF stays short to read.
  let from = 0;
  for (let i = 1; i <= facts.length; i++) {
    const a = facts[from];
    const b = facts[i];
    if (b && paperName(a.width, a.height) === paperName(b.width, b.height) && a.turn === b.turn) continue;
    const which = i - from === 1 ? `Page ${from + 1}` : `Pages ${from + 1}-${i}`;
    lines.push(`- ${which}: ${paperName(a.width, a.height)}${a.width > a.height ? "" : " (portrait)"}${a.turn ? `, turned ${a.turn}°` : ""}`);
    from = i;
  }
  if (opts.words) {
    const shown = Math.min(facts.length, 30);
    const words = await pageWords(doc.bytes, Array.from({ length: shown }, (_, i) => i));
    lines.push("", "The start of each page's words:");
    words.forEach((w, i) => lines.push(`- Page ${i + 1}: ${w ? `${w.replace(/\n/g, " / ").slice(0, 160)}${w.length > 160 ? "…" : ""}` : "(no words — blank, or a scanned picture)"}`));
    if (facts.length > shown) lines.push(`(read_words gives the rest: pages ${shown + 1}-${facts.length}.)`);
  }
  return lines.join("\n");
}

/** Run a page change from src/pdf, turning its problems into messages for Claude. */
async function change(s: Session, run: (bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>, label: string): Promise<PdfDoc> {
  const doc = needDoc(s);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await run(doc.bytes);
  } catch (e) {
    if (e instanceof LockedPdf) throw new InputError("This PDF is locked against changes (it has a password or is protected), so it can't be changed. It can still be read.");
    if (e instanceof PageProblem || e instanceof WatermarkProblem || e instanceof AddProblem || e instanceof FormProblem || e instanceof HeaderProblem || e instanceof NoteProblem) throw new InputError(e.message);
    throw e;
  }
  s.throwIfCancelled();
  s.commit(bytes, label);
  return s.doc!;
}

/** Read a PDF from the folder (for open_pdf and bring_in_pdf). */
function readPdfFile(s: Session, filename: unknown): { name: string; bytes: Uint8Array<ArrayBuffer> } {
  const folder = needFolder(s);
  const path = folder.pathFor(text(filename, "filename"), [PDF_EXTENSION], "PDF");
  const bytes = folder.read(path);
  const name = path.split(/[\\/]/).pop() ?? "Document.pdf";
  if (!looksLikePdf(bytes)) throw new InputError(`${name} doesn't look like a PDF inside. It may be damaged.`);
  return { name, bytes };
}

const PAGES = { description: 'Page numbers from 1: a number, a list, or text like "1-3, 5", "all", "odd", "even", "last".' };

export const TOOLS: ToolDef[] = [
  {
    name: "format_guide",
    title: "How JuraPDF works",
    description: "Read this first: how PDFs and pages are described to the other tools.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run: () => say(FORMAT_GUIDE),
  },
  {
    name: "live_status",
    title: "Is JuraPDF connected live?",
    description: "Says whether the user's open JuraPDF tab is connected (Live with Claude), so changes show there as you make them — and how to connect if not.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run: (s) => say(liveLine(s)),
  },
  {
    name: "describe_pdf",
    title: "Look at the PDF",
    description: "The PDF being worked on: its pages, their paper sizes and turns, and (unless \"words\": false) the start of each page's words.",
    inputSchema: { type: "object", properties: { words: { type: "boolean", description: "Include the start of each page's words (true if left out)." } } },
    readOnly: true,
    async run(s, a) {
      noExtras(a, ["words"], "describe_pdf");
      const doc = needDoc(s);
      return say(await describeDoc(doc, { words: bool(a.words, "words", true) }), s.live?.connected ? null : s.file ? `File: ${s.file}` : "Not saved to a file yet.", liveLine(s));
    },
  },
  {
    name: "read_words",
    title: "Read the words",
    description: "All the words on the chosen pages, page by page (scanned pages are pictures and have none).",
    inputSchema: { type: "object", properties: { pages: PAGES }, required: ["pages"] },
    readOnly: true,
    async run(s, a) {
      noExtras(a, ["pages"], "read_words");
      const doc = needDoc(s);
      const count = (await pageFacts(doc.bytes)).length;
      const pages = pagesOf(a.pages, count, "pages");
      const words = await pageWords(doc.bytes, pages);
      const out: string[] = [];
      let used = 0;
      for (let k = 0; k < pages.length; k++) {
        const block = `--- Page ${pages[k] + 1} ---\n${words[k] || "(no words — blank, or a scanned picture)"}`;
        if (used + block.length > MOST_WORDS) {
          out.push(`(That's as much as fits in one reply: ask for pages ${pages[k] + 1}-${pages[pages.length - 1] + 1} next.)`);
          break;
        }
        out.push(block);
        used += block.length;
      }
      return say(...out);
    },
  },
  {
    name: "add_headers",
    title: "Add headers, footers or page numbers",
    description:
      "Put words or page numbers along the top and bottom of pages, at the left, middle or right. In the words, {page} is the page's number, {pages} the last number, {date} today's date and {file} the file's name: e.g. bottom_middle \"Page {page} of {pages}\", or Bates numbers with bottom_right \"ABC{page}\" and digits 6. Adding them again replaces the ones added before; take_off: true takes them off.",
    inputSchema: {
      type: "object",
      properties: {
        top_left: { type: "string" },
        top_middle: { type: "string" },
        top_right: { type: "string" },
        bottom_left: { type: "string" },
        bottom_middle: { type: "string" },
        bottom_right: { type: "string" },
        font: { type: "string", enum: Object.keys(FONT_NAMES), description: "Helvetica if left out." },
        size: { type: "number", description: "Letter size in points (10 if left out)." },
        colour: { type: "string", description: `${Object.keys(COLOURS).filter((c) => c !== "gray").join(", ")} or "#rrggbb" (dark grey if left out).` },
        margin: { type: "number", description: "Points from the page's edges (28, about 1 cm, if left out)." },
        pages: { type: "string", description: "Which pages, e.g. \"2-\" to leave out a cover page (all if left out)." },
        start_at: { type: "number", description: "The number the first of those pages gets (1 if left out)." },
        digits: { type: "number", description: "Make numbers at least this many digits long with zeros in front, e.g. 6 for 000001 (0 if left out)." },
        take_off: { type: "boolean", description: "Take off the headers and footers added before instead." },
      },
    },
    async run(s, a) {
      const slots = { top_left: "topLeft", top_middle: "topCentre", top_right: "topRight", bottom_left: "bottomLeft", bottom_middle: "bottomCentre", bottom_right: "bottomRight" } as const;
      noExtras(a, [...Object.keys(slots), "font", "size", "colour", "color", "margin", "pages", "start_at", "digits", "take_off"], "add_headers");
      const doc = needDoc(s);
      if (bool(a.take_off, "take_off")) {
        await change(s, (bytes) => removeHeaders(bytes), "took off headers and footers");
        return say("Took off the headers and footers.");
      }
      const t = Object.fromEntries(Object.entries(slots).map(([k, slot]) => [slot, a[k] === undefined ? "" : text(a[k], k, "")])) as HeaderSettings["text"];
      const count = (await pageFacts(doc.bytes)).length;
      const settings: HeaderSettings = {
        ...DEFAULT_HEADERS,
        text: t,
        font: oneOf(a.font, Object.keys(FONT_NAMES) as FontChoice[], "font", DEFAULT_HEADERS.font),
        size: num(a.size, "size", { min: 4, max: 72, fallback: DEFAULT_HEADERS.size }),
        colour: a.colour === undefined && a.color === undefined ? DEFAULT_HEADERS.colour : colourOf(a.colour ?? a.color),
        margin: num(a.margin, "margin", { min: 0, max: 200, fallback: DEFAULT_HEADERS.margin }),
        pages: a.pages === undefined ? "all" : "range",
        range: a.pages === undefined ? "" : pagesOf(a.pages, count, "pages").map((p) => p + 1).join(", "),
        startAt: num(a.start_at, "start_at", { min: 0, max: 9_999_999, integer: true, fallback: 1 }),
        digits: num(a.digits, "digits", { min: 0, max: 12, integer: true, fallback: 0 }),
      };
      if (!hasWords(settings)) throw new InputError("Give the words for at least one spot, e.g. bottom_middle: \"Page {page} of {pages}\".");
      let pages: number[] = [];
      await change(
        s,
        async (bytes) => {
          const out = await addHeaders(bytes, settings, doc.name, dateText(new Date(), "en-GB"));
          pages = out.pages;
          return out.bytes;
        },
        `added ${headersLabel(settings)}`,
      );
      return say(`Added ${headersLabel(settings)} to ${pages.length === count ? "every page" : pagesLabel(pages.map((p) => p - 1))}.`);
    },
  },
  {
    name: "read_form",
    title: "Read the form",
    description: "The PDF's form boxes (any PDF's, not only ones added with add_form_box): each one's name, kind, what's in it now, its choices and its pages. fill_form fills them in.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run(s, a) {
      noExtras(a, [], "read_form");
      const doc = needDoc(s);
      const fields = await formFields(doc.bytes);
      if (!fields.length) return say("This PDF has no form boxes to fill in. add_form_box adds some.");
      const shown = (v: FormValue) => (typeof v === "boolean" ? (v ? "ticked" : "not ticked") : Array.isArray(v) ? (v.length ? v.map((x) => JSON.stringify(x)).join(", ") : "nothing picked") : v === "" ? "empty" : JSON.stringify(v));
      return say(
        `${plural(fields.length, "form box", "form boxes")}:`,
        ...fields.map((f) => {
          const where = f.pages.length ? ` on ${pagesLabel(f.pages)}` : "";
          const bits = [
            `- ${JSON.stringify(f.name)}: ${FORM_KIND_NAMES[f.kind]}${f.multiline ? " (several lines)" : ""}${where}, ${shown(f.value)}`,
            f.options?.length ? `choices ${f.options.map((o) => JSON.stringify(o)).join(", ")}` : "",
            f.readOnly ? "can't be changed" : "",
          ];
          return bits.filter(Boolean).join("; ");
        }),
      );
    },
  },
  {
    name: "fill_form",
    title: "Fill in the form",
    description:
      "Fill in the PDF's form boxes by name (read_form lists them): words for a text box (\"\" empties it), true or false for a tick box, one of the choices for round buttons and drop-down lists, a list of choices for a list where several can be picked. All the answers are one change.",
    inputSchema: {
      type: "object",
      properties: {
        answers: {
          type: "object",
          description: "Each box's name and its answer, e.g. {\"Work order\": \"W245354\", \"Agree\": true, \"Shift\": \"Night\"}.",
          additionalProperties: { anyOf: [{ type: "string" }, { type: "boolean" }, { type: "number" }, { type: "array", items: { type: "string" } }] },
        },
      },
      required: ["answers"],
    },
    async run(s, a) {
      noExtras(a, ["answers"], "fill_form");
      const doc = needDoc(s);
      const given = object(a.answers, "answers");
      const names = Object.keys(given);
      if (!names.length) throw new InputError("answers is empty: give each box's name and what to put in it.");
      const fields = await formFields(doc.bytes);
      if (!fields.length) throw new InputError("This PDF has no form boxes to fill in. add_form_box adds some.");
      const answers: Answer[] = names.map((name) => {
        const field = fields.find((f) => f.name === name) ?? fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
        if (!field) throw new InputError(`There's no form box called ${JSON.stringify(name)}. read_form lists them: ${fields.map((f) => JSON.stringify(f.name)).join(", ")}.`);
        const r = answerFor(field, given[name]);
        if ("problem" in r) throw new InputError(r.problem);
        return { name: field.name, value: r.value };
      });
      const label = answers.length === 1 ? answerLabel(fields.find((f) => f.name === answers[0].name)!.kind as FormBoxKind, answers[0].name, answers[0].value) : `fill in ${plural(answers.length, "form box", "form boxes")}`;
      await change(s, (bytes) => fillForm(bytes, answers), label.replace(/^fill in/, "filled in").replace(/^pick/, "picked").replace(/^tick/, "ticked").replace(/^untick/, "unticked").replace(/^clear/, "cleared"));
      return say(`Filled in ${plural(answers.length, "form box", "form boxes")}.`);
    },
  },
  {
    name: "read_notes",
    title: "Read the notes",
    description: "The sticky notes (comments) on the PDF's pages, from any reader (Acrobat, Preview, JuraPDF…): each one's id, page, place, who wrote it and when, its words and any replies.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run(s, a) {
      noExtras(a, [], "read_notes");
      const doc = needDoc(s);
      const notes = inReadingOrder(listNotes(await PDFDocument.load(doc.bytes, { updateMetadata: false, ignoreEncryption: true })));
      if (!notes.length) return say("This PDF has no notes. add_note adds one.");
      const when = (w: string) => readPdfDate(w)?.toISOString().slice(0, 16).replace("T", " ") ?? "";
      const by = (author: string, w: string) => [author && `by ${author}`, when(w) && `${when(w)} UTC`].filter(Boolean).join(", ");
      return say(
        `${plural(notes.length, "note")}:`,
        ...notes.flatMap((n) => [
          `- ${n.id}: page ${n.page + 1}, ${Math.round(n.x)} from the left and ${Math.round(n.y)} from the top${by(n.author, n.when) ? `, ${by(n.author, n.when)}` : ""}: ${JSON.stringify(n.text)}`,
          ...n.replies.map((r) => `  - reply${by(r.author, r.when) ? ` ${by(r.author, r.when)}` : ""}: ${JSON.stringify(r.text)}`),
        ]),
      );
    },
  },
  {
    name: "add_note",
    title: "Add a sticky note",
    description:
      "Pin a sticky note (a comment) to one page: a small note icon that opens to show the words, in JuraPDF, Acrobat, Preview and other readers. It doesn't change what the page shows when printed plainly. Place it in points from the page's top-left corner as it shows, e.g. next to what it's about (read_words gives where words are).",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number", description: "The page, from 1." },
        words: { type: "string", description: "What the note says (several lines are fine)." },
        x: { type: "number", description: "Points from the page's left edge to the note's icon (36 if left out)." },
        y: { type: "number", description: "Points from the page's top edge to the note's icon (36 if left out)." },
        author: { type: "string", description: "Whose note it is, shown with it (\"Claude\" if left out)." },
        colour: { type: "string", enum: NOTE_COLOURS.map((c) => c.name.toLowerCase()), description: "yellow if left out." },
      },
      required: ["page", "words"],
    },
    async run(s, a) {
      noExtras(a, ["page", "words", "x", "y", "author", "colour", "color"], "add_note");
      const doc = needDoc(s);
      const facts = await pageFacts(doc.bytes);
      const page = num(a.page, "page", { min: 1, max: facts.length, integer: true }) - 1;
      const { width, height } = facts[page];
      const words = text(a.words, "words");
      const x = num(a.x, "x", { min: 0, max: width, fallback: 36 });
      const y = num(a.y, "y", { min: 0, max: height, fallback: 36 });
      const author = a.author === undefined ? "Claude" : text(a.author, "author");
      const colour = oneOf(a.colour ?? a.color, NOTE_COLOURS.map((c) => c.name.toLowerCase()), "colour", "yellow");
      const rgb = NOTE_COLOURS.find((c) => c.name.toLowerCase() === colour)!.rgb;
      let id = "";
      await change(
        s,
        async (bytes) => {
          const out = await addNote(bytes, { page, x: Math.min(x, width - NOTE_SIZE), y: Math.min(y, height - NOTE_SIZE), text: words, author, colour: rgb });
          id = out.id;
          return out.bytes;
        },
        `added a note on page ${page + 1}`,
      );
      return say(`Added a note on page ${page + 1} (its id is ${id}).`);
    },
  },
  {
    name: "delete_note",
    title: "Delete a sticky note",
    description: "Take a sticky note (and its replies) off the PDF, by its id from read_notes.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The note's id, e.g. \"12R\" (read_notes lists them)." } }, required: ["id"] },
    async run(s, a) {
      noExtras(a, ["id"], "delete_note");
      const doc = needDoc(s);
      const id = text(a.id, "id").trim();
      const notes = listNotes(await PDFDocument.load(doc.bytes, { updateMetadata: false, ignoreEncryption: true }));
      const note = notes.find((n) => n.id === id);
      if (!note) throw new InputError(notes.length ? `There's no note ${JSON.stringify(id)}. read_notes lists them: ${notes.map((n) => n.id).join(", ")}.` : "This PDF has no notes.");
      await change(s, (bytes) => removeNote(bytes, id), `deleted the note on page ${note.page + 1}`);
      return say(`Deleted the note on page ${note.page + 1}${note.replies.length ? ` and its ${plural(note.replies.length, "reply", "replies")}` : ""}.`);
    },
  },
  {
    name: "tidy_pdf",
    title: "Tidy the PDF to make it smaller",
    description:
      "Make the PDF a little smaller without changing how it looks: drops parts left over from earlier changes that nothing uses any more and packs the rest together. Shrinking its pictures (usually the big saving) needs the JuraPDF app: the user can click \"Make smaller\" there.",
    inputSchema: { type: "object", properties: {} },
    async run(s, a) {
      noExtras(a, [], "tidy_pdf");
      const before = needDoc(s).bytes.length;
      const after = await change(s, async (bytes) => (await squeeze(bytes, "medium")).bytes, "tidied the PDF");
      const saved = before - after.bytes.length;
      return say(
        saved > 0 ? `Tidied it: ${sizeLabel(before)} → ${sizeLabel(after.bytes.length)}.` : `Tidied it, but it was already tidy (${sizeLabel(after.bytes.length)}).`,
        "For a much smaller file, the user can click \"Make smaller\" in JuraPDF, which also shrinks big pictures.",
      );
    },
  },
  {
    name: "list_pdfs",
    title: "List the PDFs in the folder",
    description: "The PDFs in the JuraPDF folder (and PNG/JPG pictures there, which add_watermark can use).",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run(s) {
      const folder = needFolder(s);
      const pdfs = folder.list([PDF_EXTENSION]);
      const pictures = folder.list([".png", ".jpg", ".jpeg"]);
      return say(
        pdfs.length ? `PDFs in ${folder.root}:` : `There are no PDFs in ${folder.root} yet. The user can put PDFs there for you to open.`,
        ...pdfs.map((f) => `- ${f.name} (${sizeLabel(f.bytes)}, ${f.modified.toISOString().slice(0, 10)})`),
        pictures.length > 0 && "Pictures (for add_picture and add_watermark):",
        ...pictures.map((f) => `- ${f.name}`),
      );
    },
  },
  {
    name: "open_pdf",
    title: "Open a PDF from the folder",
    description: "Open a PDF from the JuraPDF folder to work on. When JuraPDF is connected live, it opens there too, in place of the user's PDF (they can Undo that).",
    inputSchema: { type: "object", properties: { filename: { type: "string" } }, required: ["filename"] },
    destructive: true,
    async run(s, a) {
      noExtras(a, ["filename"], "open_pdf");
      const doc = readPdfFile(s, a.filename);
      const facts = await pageFacts(doc.bytes).catch((e: Error) => {
        throw new InputError(`${doc.name}: ${e.message}`);
      });
      if (!facts.length) throw new InputError(`${doc.name} has no pages.`);
      s.reset(doc, doc.name);
      s.label = `opened ${doc.name}`;
      return say(`Opened ${doc.name}.`, await describeDoc(doc, { words: true }));
    },
  },
  {
    name: "new_pdf",
    title: "Start a new PDF",
    description: "Start a new PDF of blank pages (the one being worked on is dropped unless it was saved).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: 'Its file name, e.g. "Notes" (".pdf" is added).' },
        pages: { type: "number", description: "How many blank pages, 1–200 (1 if left out)." },
        size: { type: "string", enum: Object.keys(SIZES), description: "Paper size (A4 if left out)." },
        landscape: { type: "boolean" },
      },
    },
    destructive: true,
    async run(s, a) {
      noExtras(a, ["name", "pages", "size", "landscape"], "new_pdf");
      const count = num(a.pages, "pages", { min: 1, max: 200, integer: true, fallback: 1 });
      const size = oneOf(a.size, Object.keys(SIZES), "size", "A4");
      const [w, h] = SIZES[size];
      const wide = bool(a.landscape, "landscape");
      const pdf = await PDFDocument.create();
      for (let i = 0; i < count; i++) pdf.addPage(wide ? [h, w] : [w, h]);
      const name = `${fileNameFor(text(a.name, "name", "New PDF")).replace(/\.pdf$/i, "")}${PDF_EXTENSION}`;
      s.reset({ name, bytes: (await pdf.save()) as Uint8Array<ArrayBuffer> }, null);
      s.label = `started ${name}`;
      return say(`Started ${name}: ${plural(count, `blank ${size}${wide ? " landscape" : ""} page`)}.`);
    },
  },
  {
    name: "save_pdf",
    title: "Save the PDF",
    description: "Save the PDF in the JuraPDF folder, for the user to open in JuraPDF (or anything else that opens PDFs).",
    inputSchema: { type: "object", properties: { filename: { type: "string", description: "Left out: the file it was opened from (or its name)." }, overwrite: { type: "boolean" } } },
    run(s, a) {
      noExtras(a, ["filename", "overwrite"], "save_pdf");
      const doc = needDoc(s);
      const folder = needFolder(s);
      const given = typeof a.filename === "string" && a.filename.trim() ? a.filename : null;
      const path = folder.pathFor(given ?? s.file ?? doc.name, [PDF_EXTENSION], "PDF");
      const name = path.split(/[\\/]/).pop() ?? "";
      // Saving again to the file it came from needs no asking.
      if (name !== s.file) checkFree(s, path, a.overwrite);
      writeOut(s, path, doc.bytes);
      if (!s.live?.connected) s.file = name;
      return say(
        `Saved ${name} in ${folder.root}.`,
        s.live?.connected ? "This is a copy: the user's own PDF is saved with Save in JuraPDF." : "The user can open it at https://gm7dha.github.io/JuraPDF/ with Open (or by dragging the file onto the window).",
      );
    },
  },
  {
    name: "add_watermark",
    title: "Add a watermark",
    description:
      'Add a watermark saved into the pages: words (e.g. "CONFIDENTIAL", "DRAFT", "UNCONTROLLED DOCUMENT") or a PNG/JPG picture from the JuraPDF folder (e.g. a logo). Corner to corner, see-through red, in front, on every page unless told otherwise.',
    inputSchema: {
      type: "object",
      properties: {
        words: { type: "string", description: "The words (one line, ordinary letters)." },
        picture: { type: "string", description: "Instead of words: a PNG or JPG file in the JuraPDF folder." },
        font: { type: "string", enum: Object.keys(FONT_NAMES), description: "HelveticaBold if left out." },
        colour: { type: "string", description: `${Object.keys(COLOURS).filter((c) => c !== "gray").join(", ")} or "#rrggbb" (red if left out).` },
        size: { description: '"fit" (fills the page, the usual) or a letter size in points, 4–400.' },
        picture_width: { type: "number", description: "A picture's width, 5–100 % of the page (50 if left out)." },
        angle: { description: '"diagonal" (corner to corner, the usual), "level", or degrees from -180 to 180 rising to the right.' },
        placement: { type: "string", enum: Object.keys(PLACEMENT_NAMES), description: '"middle" if left out; "repeat" tiles it across the page.' },
        see_through: { type: "number", description: "How see-through, 0 (solid) to 95 (barely there); 70 if left out." },
        behind: { type: "boolean", description: "Behind what's on the page instead of in front (it can be hidden on scanned pages)." },
        pages: { ...PAGES, description: `${PAGES.description} Every page if left out.` },
      },
    },
    async run(s, a) {
      noExtras(a, ["words", "picture", "font", "colour", "color", "size", "picture_width", "angle", "placement", "see_through", "behind", "pages"], "add_watermark");
      const doc = needDoc(s);
      const hasWords = typeof a.words === "string" && a.words.trim() !== "";
      const hasPicture = typeof a.picture === "string" && a.picture.trim() !== "";
      if (hasWords === hasPicture) throw new InputError('add_watermark: give either "words" or "picture" (one of them).');
      const settings: WatermarkSettings = { ...DEFAULT_WATERMARK, kind: hasWords ? "words" : "picture", text: hasWords ? text(a.words, "words") : "" };
      settings.font = oneOf(a.font, Object.keys(FONT_NAMES) as FontChoice[], "font", DEFAULT_WATERMARK.font);
      settings.colour = colourOf(a.colour ?? a.color);
      if (a.size !== undefined && a.size !== null && a.size !== "fit") {
        settings.sizeMode = "set";
        settings.size = num(a.size, "size", { min: 4, max: 400 });
      }
      settings.pictureWidth = num(a.picture_width, "picture_width", { min: 5, max: 100, fallback: DEFAULT_WATERMARK.pictureWidth });
      if (a.angle === "level" || a.angle === "diagonal" || a.angle === undefined || a.angle === null) settings.angle = (a.angle as "level" | "diagonal" | undefined) ?? "diagonal";
      else {
        settings.angle = "custom";
        settings.customAngle = num(a.angle, "angle", { min: -180, max: 180 });
      }
      settings.placement = oneOf(a.placement, Object.keys(PLACEMENT_NAMES) as Placement[], "placement", "middle");
      settings.seeThrough = num(a.see_through, "see_through", { min: 0, max: 95, fallback: DEFAULT_WATERMARK.seeThrough });
      settings.behind = bool(a.behind, "behind");
      let picture: WatermarkPicture | undefined;
      if (hasPicture) {
        const folder = needFolder(s);
        const path = folder.pathFor(text(a.picture, "picture"), [".png", ".jpg", ".jpeg"], "picture");
        picture = readPicture(folder, path);
      }
      const count = (await pageFacts(doc.bytes)).length;
      const pages = a.pages === undefined || a.pages === null ? undefined : pagesOf(a.pages, count, "pages");
      let on: number[] = [];
      const what = hasWords ? `"${settings.text}"` : picture!.name;
      const where = pages ? pagesLabel(pages) : "every page";
      await change(
        s,
        async (bytes) => {
          const out = await addWatermark(bytes, settings, picture, pages?.map((p) => p + 1));
          on = out.pages;
          return out.bytes as Uint8Array<ArrayBuffer>;
        },
        `added a ${what} watermark to ${where}`,
      );
      return say(`Added the ${what} watermark to ${on.length === count ? "every page" : pagesLabel(on.map((p) => p - 1))}${settings.behind ? ", behind what's on the page" : ""}.`);
    },
  },
  {
    name: "add_words",
    title: "Add words to a page",
    description:
      "Write words onto one page, where they're asked for (e.g. a note, a name and date, \"Approved\"). Positions are in points (72 to the inch) from the page's top-left corner as it shows; describe_pdf gives each page's size. Several lines are fine (\\n between them).",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number", description: "The page, from 1." },
        words: { type: "string", description: "The words (ordinary letters: English and most European ones)." },
        x: { type: "number", description: "Points from the page's left edge to where the words start (72 if left out)." },
        y: { type: "number", description: "Points from the page's top edge to the top of the first line (72 if left out)." },
        font: { type: "string", enum: Object.keys(FONT_NAMES), description: "Helvetica if left out." },
        size: { type: "number", description: `Letter size in points, 4–300 (${DEFAULT_WORDS.size} if left out).` },
        colour: { type: "string", description: `${Object.keys(COLOURS).filter((c) => c !== "gray").join(", ")} or "#rrggbb" (near-black if left out).` },
      },
      required: ["page", "words"],
    },
    async run(s, a) {
      noExtras(a, ["page", "words", "x", "y", "font", "size", "colour", "color"], "add_words");
      const doc = needDoc(s);
      const facts = await pageFacts(doc.bytes);
      const page = num(a.page, "page", { min: 1, max: facts.length, integer: true }) - 1;
      const { width, height } = facts[page];
      const item = {
        kind: "words" as const,
        page,
        text: text(a.words, "words"),
        x: num(a.x, "x", { min: 0, max: width, fallback: 72 }),
        y: num(a.y, "y", { min: 0, max: height, fallback: 72 }),
        font: oneOf(a.font, Object.keys(FONT_NAMES) as FontChoice[], "font", DEFAULT_WORDS.font),
        size: cleanSize(num(a.size, "size", { min: 4, max: 300, fallback: DEFAULT_WORDS.size })),
        colour: a.colour === undefined && a.color === undefined ? DEFAULT_WORDS.colour : colourOf(a.colour ?? a.color),
      };
      if (!linesOf(item.text).length) throw new InputError("words: give some words to write.");
      const label = additionLabel(item).replace(/^add/, "added");
      await change(s, (bytes) => addWords(bytes, item), label);
      return say(`Added the words to page ${page + 1}, ${Math.round(item.x)} points from the left and ${Math.round(item.y)} from the top.`);
    },
  },
  {
    name: "add_shape",
    title: "Highlight or draw on a page",
    description:
      "Highlight words (a see-through colour over them, yellow unless asked otherwise) or draw a box, oval, line or arrow on one page, e.g. to point something out. Give two corners (or a line's two ends, an arrow pointing at the second) in points from the page's top-left corner as it shows.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number", description: "The page, from 1." },
        shape: { type: "string", enum: Object.keys(SHAPE_NAMES), description: "What to draw." },
        x1: { type: "number", description: "Points from the left edge to the first corner (or the start of a line or arrow)." },
        y1: { type: "number", description: "Points from the top edge to the first corner." },
        x2: { type: "number", description: "Points from the left edge to the opposite corner (or where an arrow points)." },
        y2: { type: "number", description: "Points from the top edge to the opposite corner." },
        colour: { type: "string", description: `${Object.keys(COLOURS).filter((c) => c !== "gray").join(", ")}, yellow or "#rrggbb" (yellow for a highlight, red otherwise, if left out).` },
        thickness: { type: "number", description: "How thick the lines are in points, 0.5–20 (2 if left out; not used by a highlight)." },
        fill: { type: "string", description: "A box or oval filled in with this colour (same choices as colour); left empty if left out." },
        see_through: { type: "number", description: "How see-through a box, oval, line or arrow is, 0 (solid, if left out) to 90 percent." },
      },
      required: ["page", "shape", "x1", "y1", "x2", "y2"],
    },
    async run(s, a) {
      noExtras(a, ["page", "shape", "x1", "y1", "x2", "y2", "colour", "color", "thickness", "fill", "see_through"], "add_shape");
      const doc = needDoc(s);
      const facts = await pageFacts(doc.bytes);
      const page = num(a.page, "page", { min: 1, max: facts.length, integer: true }) - 1;
      const { width, height } = facts[page];
      const shape = oneOf(a.shape, Object.keys(SHAPE_NAMES) as ShapeKind[], "shape", "box");
      const c = a.colour ?? a.color;
      const item = {
        kind: "shape" as const,
        shape,
        page,
        x1: num(a.x1, "x1", { min: 0, max: width }),
        y1: num(a.y1, "y1", { min: 0, max: height }),
        x2: num(a.x2, "x2", { min: 0, max: width }),
        y2: num(a.y2, "y2", { min: 0, max: height }),
        colour: c === undefined ? SHAPE_STYLE[shape].colour : typeof c === "string" && c.trim().toLowerCase() === "yellow" ? "#ffd400" : colourOf(c),
        thickness: shape === "highlight" ? 0 : num(a.thickness, "thickness", { min: 0.5, max: 20, fallback: SHAPE_STYLE[shape].thickness }),
        fill: a.fill === undefined || a.fill === null || a.fill === "" || (shape !== "box" && shape !== "oval") ? null : typeof a.fill === "string" && a.fill.trim().toLowerCase() === "yellow" ? "#ffd400" : colourOf(a.fill),
        seeThrough: shape === "highlight" ? undefined : num(a.see_through, "see_through", { min: 0, max: 90, fallback: 0 }),
      };
      if (Math.hypot(item.x2 - item.x1, item.y2 - item.y1) < 2) throw new InputError("The two corners are in the same place: give two points apart.");
      const label = additionLabel(item).replace(/^add/, "added");
      await change(s, (bytes) => addShape(bytes, item), label);
      return say(`Added ${additionLabel(item).replace(/^add /, "")}.`);
    },
  },
  {
    name: "add_form_box",
    title: "Add a form box to fill in",
    description:
      "Put a form box on one page that whoever opens the PDF (in Acrobat, Preview, a browser…) can fill in: a text box to type in, a tick box, or a choice list. Give its top-left corner in points from the page's top-left as it shows, and its size (left out: a usual size for the kind). read_words gives where the words are, e.g. to put a box beside a label.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number", description: "The page, from 1." },
        kind: { type: "string", enum: ["text", "tick", "choice"], description: "A text box, a tick box or a choice list." },
        x: { type: "number", description: "Points from the left edge to its left side." },
        y: { type: "number", description: "Points from the top edge to its top." },
        width: { type: "number", description: "Its width in points (180 for a text box, 14 for a tick box, 150 for a list, if left out)." },
        height: { type: "number", description: "Its height in points (22, or 14 for a tick box, if left out; a tick box is square)." },
        name: { type: "string", description: "Its name in the form, e.g. \"Work order\" (each box's is different; a number is added if it's taken)." },
        several_lines: { type: "boolean", description: "A text box: let several lines be typed (false if left out)." },
        choices: { type: "array", items: { type: "string" }, description: "A choice list: what can be chosen." },
      },
      required: ["page", "kind", "x", "y"],
    },
    async run(s, a) {
      noExtras(a, ["page", "kind", "x", "y", "width", "height", "name", "several_lines", "choices"], "add_form_box");
      const doc = needDoc(s);
      const facts = await pageFacts(doc.bytes);
      const page = num(a.page, "page", { min: 1, max: facts.length, integer: true }) - 1;
      const { width: pw, height: ph } = facts[page];
      const field = oneOf(a.kind, ["text", "tick", "choice"] as const, "kind");
      const size = FIELD_SIZE[field];
      const width = num(a.width, "width", { min: 6, max: pw, fallback: size.width });
      const height = field === "tick" ? width : num(a.height, "height", { min: 6, max: ph, fallback: size.height });
      let choices: string[] | undefined;
      if (field === "choice") {
        if (!Array.isArray(a.choices) || !a.choices.every((c) => typeof c === "string")) throw new InputError("choices should be a list of words, e.g. [\"Day\", \"Night\"].");
        choices = choicesOf((a.choices as string[]).join("\n"));
        if (!choices.length) throw new InputError("choices should have at least one choice.");
      }
      const item = {
        kind: "field" as const,
        field,
        page,
        x: num(a.x, "x", { min: 0, max: pw - 1 }),
        y: num(a.y, "y", { min: 0, max: ph - 1 }),
        width,
        height,
        name: a.name === undefined ? "" : text(a.name, "name"),
        multiline: bool(a.several_lines, "several_lines"),
        choices,
      };
      await change(s, (bytes) => addItems(bytes, [item]), additionLabel(item).replace(/^add/, "added"));
      return say(`Added ${additionLabel(item).replace(/^add /, "")}.`);
    },
  },
  {
    name: "add_picture",
    title: "Add a picture to a page",
    description:
      "Put a PNG or JPG picture from the JuraPDF folder (e.g. a signature, a stamp or a logo) onto one page. Positions and sizes are in points (72 to the inch) from the page's top-left corner as it shows.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number", description: "The page, from 1." },
        picture: { type: "string", description: "A PNG or JPG file in the JuraPDF folder." },
        x: { type: "number", description: "Points from the page's left edge to the picture's left side (72 if left out)." },
        y: { type: "number", description: "Points from the page's top edge to the picture's top (72 if left out)." },
        width: { type: "number", description: "Its width in points (its height keeps its shape). Its own size, up to half the page, if left out." },
      },
      required: ["page", "picture"],
    },
    async run(s, a) {
      noExtras(a, ["page", "picture", "x", "y", "width"], "add_picture");
      const doc = needDoc(s);
      const folder = needFolder(s);
      const picture = readPicture(folder, folder.pathFor(text(a.picture, "picture"), [".png", ".jpg", ".jpeg"], "picture"));
      const facts = await pageFacts(doc.bytes);
      const page = num(a.page, "page", { min: 1, max: facts.length, integer: true }) - 1;
      const { width: pw, height: ph } = facts[page];
      const px = pixelSize(picture.bytes, picture.type);
      const start = startingPictureSize(px.w, px.h, pw, ph);
      const width = num(a.width, "width", { min: 4, max: pw * 2, fallback: start.width });
      const height = (width * start.height) / start.width;
      const item = { kind: "picture" as const, page, x: num(a.x, "x", { min: -width, max: pw, fallback: 72 }), y: num(a.y, "y", { min: -height, max: ph, fallback: 72 }), width, height };
      await change(s, (bytes) => addPicture(bytes, item, picture), `added ${picture.name} to page ${page + 1}`);
      return say(`Added ${picture.name} to page ${page + 1}: ${Math.round(width)} × ${Math.round(height)} points, its top-left corner ${Math.round(item.x)} points from the left and ${Math.round(item.y)} from the top.`);
    },
  },
  {
    name: "turn_pages",
    title: "Turn pages",
    description: "Turn pages a quarter turn clockwise (right) or anticlockwise (left), or upside down (half).",
    inputSchema: { type: "object", properties: { pages: PAGES, direction: { type: "string", enum: ["right", "left", "half"] } }, required: ["pages", "direction"] },
    async run(s, a) {
      noExtras(a, ["pages", "direction"], "turn_pages");
      const doc = needDoc(s);
      const pages = pagesOf(a.pages, (await pageFacts(doc.bytes)).length, "pages");
      const direction = oneOf(a.direction, ["right", "left", "half"] as const, "direction");
      const by = direction === "right" ? 90 : direction === "left" ? -90 : 180;
      const words = direction === "half" ? "upside down" : `a quarter turn ${direction === "right" ? "clockwise" : "anticlockwise"}`;
      await change(s, (bytes) => turnPages(bytes, pages, by), `turned ${pagesLabel(pages)}`);
      return say(`Turned ${pagesLabel(pages)} ${words}.`);
    },
  },
  {
    name: "delete_pages",
    title: "Delete pages",
    description: "Delete pages (a PDF keeps at least one page).",
    inputSchema: { type: "object", properties: { pages: PAGES }, required: ["pages"] },
    destructive: true,
    async run(s, a) {
      noExtras(a, ["pages"], "delete_pages");
      const doc = needDoc(s);
      const count = (await pageFacts(doc.bytes)).length;
      const pages = pagesOf(a.pages, count, "pages");
      await change(s, (bytes) => deletePages(bytes, pages), `deleted ${pagesLabel(pages)}`);
      return say(`Deleted ${pagesLabel(pages)}. The PDF now has ${plural(count - pages.length, "page")}.`);
    },
  },
  {
    name: "move_pages",
    title: "Move pages",
    description: 'Move pages (kept in their order) to just before another page, numbered as the pages are now — or to the "start" or the "end".',
    inputSchema: { type: "object", properties: { pages: PAGES, before: { description: 'The page they go just before (as numbered now), or "start" / "end".' } }, required: ["pages", "before"] },
    async run(s, a) {
      noExtras(a, ["pages", "before"], "move_pages");
      const doc = needDoc(s);
      const count = (await pageFacts(doc.bytes)).length;
      const pages = pagesOf(a.pages, count, "pages");
      const at = beforeOf(a.before, count);
      const order = moveTo(count, pages, at);
      if (sameOrder(order)) return say(`${pagesLabel(pages)[0].toUpperCase()}${pagesLabel(pages).slice(1)} ${pages.length === 1 ? "is" : "are"} already there: nothing changed.`);
      await change(s, (bytes) => reorderPages(bytes, order), `moved ${pagesLabel(pages)}`);
      const first = order.indexOf(pages[0]) + 1;
      return say(`Moved ${pagesLabel(pages)}: ${pages.length === 1 ? "it's" : "they're"} now page${pages.length === 1 ? ` ${first}` : `s ${first}-${first + pages.length - 1}`}.`);
    },
  },
  {
    name: "add_blank_pages",
    title: "Add blank pages",
    description: "Add blank pages after a page (0 = at the very start), each the size and way round of the page before it.",
    inputSchema: { type: "object", properties: { after: { description: 'The page they go after (0 = the start, "end" = after the last).' }, count: { type: "number", description: "How many, 1–100 (1 if left out)." } }, required: ["after"] },
    async run(s, a) {
      noExtras(a, ["after", "count"], "add_blank_pages");
      const doc = needDoc(s);
      const pageCount = (await pageFacts(doc.bytes)).length;
      const after = placeOf(a.after, pageCount, "after");
      const many = num(a.count, "count", { min: 1, max: 100, integer: true, fallback: 1 });
      await change(
        s,
        async (bytes) => {
          let out = bytes;
          for (let i = 0; i < many; i++) out = await addBlankPage(out, after + i);
          return out;
        },
        many === 1 ? "added a blank page" : `added ${many} blank pages`,
      );
      return say(`Added ${plural(many, "blank page")} ${after === 0 ? "at the start" : `after page ${after}`}: ${many === 1 ? `page ${after + 1}` : `pages ${after + 1}-${after + many}`}.`);
    },
  },
  {
    name: "bring_in_pdf",
    title: "Bring in pages from another PDF",
    description: "Put all the pages of another PDF from the JuraPDF folder after a page (0 = at the start). This is how to join PDFs.",
    inputSchema: { type: "object", properties: { filename: { type: "string" }, after: { description: 'The page they go after (0 = the start, "end" = after the last; the end if left out).' } }, required: ["filename"] },
    async run(s, a) {
      noExtras(a, ["filename", "after"], "bring_in_pdf");
      const doc = needDoc(s);
      const count = (await pageFacts(doc.bytes)).length;
      const other = readPdfFile(s, a.filename);
      const after = a.after === undefined || a.after === null ? count : placeOf(a.after, count, "after");
      let added = 0;
      await change(
        s,
        async (bytes) => {
          const out = await insertPdf(bytes, other.bytes, other.name, after);
          added = out.added;
          return out.bytes;
        },
        `brought in ${other.name}`,
      );
      return say(`Brought in ${plural(added, "page")} from ${other.name} ${after === 0 ? "at the start" : `after page ${after}`}: now ${added === 1 ? `page ${after + 1}` : `pages ${after + 1}-${after + added}`}. The PDF has ${plural(count + added, "page")}.`);
    },
  },
  {
    name: "save_pages_as_pdf",
    title: "Save pages as a new PDF",
    description: "Save some pages as a new PDF of their own in the JuraPDF folder (the PDF being worked on doesn't change). This is how to split a PDF.",
    inputSchema: { type: "object", properties: { pages: PAGES, filename: { type: "string" }, overwrite: { type: "boolean" } }, required: ["pages", "filename"] },
    async run(s, a) {
      noExtras(a, ["pages", "filename", "overwrite"], "save_pages_as_pdf");
      const doc = needDoc(s);
      const folder = needFolder(s);
      const pages = pagesOf(a.pages, (await pageFacts(doc.bytes)).length, "pages");
      const path = folder.pathFor(text(a.filename, "filename"), [PDF_EXTENSION], "PDF");
      checkFree(s, path, a.overwrite);
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = await extractPages(doc.bytes, pages);
      } catch (e) {
        if (e instanceof LockedPdf) throw new InputError("This PDF is locked against changes, so its pages can't be saved as a new PDF.");
        throw e;
      }
      writeOut(s, path, bytes);
      return say(`Saved ${pagesLabel(pages)} as ${path.split(/[\\/]/).pop()} in ${folder.root}.`);
    },
  },
  {
    name: "undo",
    title: "Undo your last change",
    description: "Take back the last change you made to the PDF (one step at a time).",
    inputSchema: { type: "object", properties: {} },
    run(s) {
      const undone = s.undo();
      if (!undone) return say(s.live?.connected ? "There's nothing of yours to undo here. (The user can undo any step in JuraPDF with its Undo button.)" : "There's nothing to undo.");
      return say(`Took back: ${undone}.`);
    },
  },
];

// Running a tool

export async function callTool(s: Session, name: string, args: unknown, signal?: AbortSignal): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: "text", text: `There's no tool called "${name}". The tools are: ${TOOLS.map((t) => t.name).join(", ")}.` }], isError: true };
  const run = async (): Promise<ToolResult> => {
    // Cancelled while waiting its turn: don't start.
    if (signal?.aborted) return cancelledResult();
    const snap = s.snapshot();
    s.signal = signal ?? null;
    s.wroteFile = false;
    try {
      const a = args === undefined || args === null ? {} : object(args, "The input");
      const result = await tool.run(s, a);
      // Cancelled at the very end: the change is taken back too (unless a file was already written).
      if (signal?.aborted && !s.wroteFile) {
        s.restore(snap);
        return cancelledResult();
      }
      return result;
    } catch (e) {
      s.restore(snap);
      if (e instanceof Cancelled || (signal?.aborted && !s.wroteFile)) return cancelledResult();
      if (e instanceof InputError) return { content: [{ type: "text", text: e.message }], isError: true };
      if (e instanceof LockedPdf) return { content: [{ type: "text", text: "This PDF is locked (it has a password or is protected against changes), so it can't be changed or read here." }], isError: true };
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Something went wrong inside JuraPDF (${msg}). The PDF wasn't changed by this. Try describe_pdf, or a different approach.` }], isError: true };
    } finally {
      s.signal = null;
    }
  };
  // One call at a time. Live: on the PDF open in the user's JuraPDF tab, with any change sent back to it.
  return s.serial(() => (s.live ? s.live.call(s, name, run, signal) : run()));
}

/** What a cancelled call says (Claude has stopped waiting, so it's mostly for logs and tests). */
export function cancelledResult(): ToolResult {
  return { content: [{ type: "text", text: "Cancelled: the call was stopped before it finished, and nothing was changed." }], isError: true };
}
