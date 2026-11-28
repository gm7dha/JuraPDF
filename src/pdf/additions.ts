/**
 * Writing words and pictures onto a page, with pdf-lib (in the browser and in
 * Node for the tests and Claude). Where things go is worked out in
 * src/model/additions.ts.
 */
import {
  BlendMode,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  drawImage,
  setFillingRgbColor,
  LineCapStyle,
  StandardFontEmbedder,
  TextRenderingMode,
  beginText,
  degrees,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  rotateAndSkewTextDegreesAndTranslate,
  setCharacterSqueeze,
  setFontAndSize,
  setTextRenderingMode,
  showText,
  type PDFPage,
} from "pdf-lib";

import { canFill, freshFieldName, inkBox, lineStarts, opacityOf, shapeBox, shapeInPage, linesOf, strokePath, wordsHeight, type AddItem, type FieldItem, type InkItem, type PictureItem, type Rect, type ShapeItem, type WordsItem } from "../model/additions";
import { encodeWith } from "../model/fontCodes";
import type { HiddenWord } from "../model/ocr";
import { hexToRgb, toPageSpace, type FontChoice } from "../model/watermark";
import { pageFont, type PageFont } from "./fonts";
import { endMark, keptOn, nextId, noteKept, removeMarked, setKept, startMark } from "./items";
import { FONTS, arrange, existingContents, frameOf, loadForEditing, saveEdited } from "./watermark";

/** Something stops the words or picture being added; the message says what. */
export class AddProblem extends Error {}

const embedders = new Map<FontChoice, StandardFontEmbedder>();
const embedderFor = (font: FontChoice) => {
  let e = embedders.get(font);
  if (!e) embedders.set(font, (e = StandardFontEmbedder.for(FONTS[font] as unknown as Parameters<typeof StandardFontEmbedder.for>[0])));
  return e;
};

/** How wide words are in a font, in points (for sizing the box they're typed in). */
export function textWidth(font: FontChoice, text: string, size: number): number {
  try {
    return embedderFor(font).widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.55;
  }
}

/** Letters the built-in fonts can't write (they cover English and most European letters), or "" when all can be. */
export function unwritable(font: FontChoice, text: string): string {
  const bad = new Set<string>();
  for (const ch of text.replace(/\s/g, "")) {
    try {
      embedderFor(font).encodeText(ch);
    } catch {
      bad.add(ch);
    }
  }
  return [...bad].join(" ");
}

function pageOf(doc: PDFDocument, n: number) {
  if (n < 0 || n >= doc.getPageCount()) throw new AddProblem(`This PDF has no page ${n + 1}.`);
  return doc.getPage(n);
}

async function save(doc: PDFDocument): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await saveEdited(doc);
  noteKept(bytes, doc);
  return bytes;
}

/** Write words onto their page. Gives the new file. */
export async function addWords(bytes: Uint8Array, item: WordsItem): Promise<Uint8Array<ArrayBuffer>> {
  return addItems(bytes, [item]);
}

/** A picture's file. */
export interface PictureFile {
  bytes: Uint8Array;
  type: "png" | "jpg";
  name: string;
}

/** Put a picture onto its page. Gives the new file. */
export async function addPicture(bytes: Uint8Array, item: PictureItem, picture: PictureFile): Promise<Uint8Array<ArrayBuffer>> {
  return addItems(bytes, [item], picture);
}

/** Draw a highlight, box, oval, line or arrow on its page. Gives the new file. */
export async function addShape(bytes: Uint8Array, item: ShapeItem): Promise<Uint8Array<ArrayBuffer>> {
  return addItems(bytes, [item]);
}

/** Several shapes at once (e.g. a highlight over each line of the words picked), as one change. */
export async function addShapes(bytes: Uint8Array, items: ShapeItem[]): Promise<Uint8Array<ArrayBuffer>> {
  return addItems(bytes, items);
}

/**
 * Write words, pictures, shapes and pen drawings onto their pages, as one
 * change, each marked so it can be picked and changed later (src/pdf/items.ts).
 * `picture` is the file for a new picture. Gives the new file.
 */
export async function addItems(bytes: Uint8Array, items: AddItem[], picture?: PictureFile): Promise<Uint8Array<ArrayBuffer>> {
  for (const item of items) check(item);
  const doc = await loadForEditing(bytes);
  for (const index of [...new Set(items.map((i) => i.page))]) {
    const page = pageOf(doc, index);
    const before = existingContents(page);
    const kept = keptOn(page, index);
    let id = nextId(page);
    for (const item of items.filter((i) => i.page === index)) {
      const written = await drawItem(doc, page, item, id, picture);
      kept.push({ id, item: written.item, box: written.box });
      id++;
    }
    setKept(page, kept);
    arrange(page, before, false);
  }
  return save(doc);
}

/**
 * Change one of JuraPDF's own additions (`id` on page `index`) to `next`, or
 * take it off the page (null). It's drawn again on top. Gives the new file.
 */
export async function changeItem(bytes: Uint8Array, index: number, id: number, next: AddItem | null): Promise<Uint8Array<ArrayBuffer>> {
  if (next) check(next);
  const doc = await loadForEditing(bytes);
  const page = pageOf(doc, index);
  const kept = keptOn(page, index);
  const was = kept.find((k) => k.id === id);
  if (!was) throw new AddProblem("That isn't on the page any more.");
  const rest = kept.filter((k) => k.id !== id);
  if (was.item.kind === "field" ? !removeField(doc, was.item.name) : !removeMarked(page, id)) {
    setKept(page, rest);
    throw new AddProblem("That was changed by another program, so it can't be picked here any more.");
  }
  if (next) {
    const before = existingContents(page);
    const written = await drawItem(doc, page, { ...next, page: index } as AddItem, id);
    rest.push({ id, item: written.item, box: written.box });
    arrange(page, before, false);
  }
  setKept(page, rest);
  return save(doc);
}

/** Turn away what can't be written, before anything is changed. */
function check(item: AddItem): void {
  if (item.kind === "words" && !linesOf(item.text).length && !item.cover) throw new AddProblem("Type some words first.");
  if (item.kind === "ink" && !item.strokes.some((s) => s.length)) throw new AddProblem("Draw something first.");
  if (item.kind === "field" && item.field === "choice" && !item.choices?.length) throw new AddProblem("Type the choices for the list first, one to a line.");
}

/** Draw one addition between its markers; gives it as remembered (without its id) and the box it covers. */
async function drawItem(doc: PDFDocument, page: PDFPage, item: AddItem, id: number, picture?: PictureFile): Promise<{ item: AddItem; box: Rect }> {
  const frame = frameOf(page);
  const clean = { ...item, id: undefined } as AddItem;
  if (clean.kind === "picture" && !clean.image) {
    if (!picture) throw new AddProblem("Choose a picture first.");
    let image;
    try {
      image = picture.type === "png" ? await doc.embedPng(picture.bytes) : await doc.embedJpg(picture.bytes);
    } catch {
      throw new AddProblem(`${picture.name} couldn't be read as a picture. Try a PNG or JPG.`);
    }
    clean.image = page.node.newXObject("Image", image.ref).decodeText();
  }
  // A form box isn't drawn into the page: it's a box of the PDF's form, laid over the page.
  if (clean.kind === "field") return addField(doc, page, frame, clean);
  // Words need their font ready before anything is drawn (and may be turned away).
  const words = clean.kind === "words" ? await wordsInk(doc, page, clean) : null;
  startMark(page, id);
  let box: Rect;
  if (clean.kind === "words" && words) box = drawWords(page, frame, clean, words);
  else if (clean.kind === "picture") {
    const shownH = frame.rotation % 180 ? frame.width : frame.height;
    // Pictures are turned about their bottom-left corner, so start from that corner as shown.
    const at = toPageSpace(frame, clean.x, shownH - (clean.y + clean.height), 0);
    page.pushOperators(...drawImage(clean.image as string, { x: at.x, y: at.y, width: clean.width, height: clean.height, rotate: degrees(at.angle), xSkew: degrees(0), ySkew: degrees(0) }));
    box = { x: clean.x, y: clean.y, width: clean.width, height: clean.height };
  } else if (clean.kind === "shape") {
    drawShape(page, frame, clean);
    const b = shapeBox(clean);
    const pad = clean.shape === "highlight" ? 0 : clean.thickness / 2;
    box = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
  } else if (clean.kind === "ink") {
    drawInk(page, frame, clean);
    box = inkBox(clean);
  } else throw new AddProblem("That can't be added.");
  endMark(page);
  if (clean.kind === "words" && clean.own) clean.own = { base: clean.own.base, label: clean.own.label };
  return { item: clean, box };
}

const GREY = rgb(0.45, 0.5, 0.56);

/** Put a form box on the page (named so no other box has its name). */
function addField(doc: PDFDocument, page: PDFPage, frame: ReturnType<typeof frameOf>, item: FieldItem): { item: AddItem; box: Rect } {
  const form = doc.getForm();
  const taken = form.getFields().map((f) => f.getName());
  // (A dot would make it part of another box's name, in a form.)
  const wanted = item.name.replace(/\./g, " ").trim();
  const name = wanted && !taken.includes(wanted) ? wanted : freshFieldName(item.field, taken);
  const shownH = frame.rotation % 180 ? frame.width : frame.height;
  // Form boxes are turned about their bottom-left corner, like pictures.
  const at = toPageSpace(frame, item.x, shownH - (item.y + item.height), 0);
  const place = { x: at.x, y: at.y, width: item.width, height: item.height, rotate: degrees(at.angle), borderColor: GREY, borderWidth: 1, backgroundColor: rgb(1, 1, 1) };
  if (item.field === "text") {
    const field = form.createTextField(name);
    if (item.multiline) field.enableMultiline();
    field.addToPage(page, place);
    if (item.size) field.setFontSize(item.size);
  } else if (item.field === "tick") {
    form.createCheckBox(name).addToPage(page, place);
  } else {
    const field = form.createDropdown(name);
    const choices = item.choices?.length ? item.choices : ["Yes", "No"];
    field.setOptions(choices);
    field.addToPage(page, place);
    field.setFontSize(0);
  }
  return { item: { ...item, name, id: undefined }, box: { x: item.x, y: item.y, width: item.width, height: item.height } };
}

/** Take a form box (by name) out of the form and off its page; false when there's none of that name. */
export function removeField(doc: PDFDocument, name: string): boolean {
  const field = doc.getForm().getFieldMaybe(name);
  if (!field) return false;
  // Its drawings on the pages go first (pdf-lib doesn't always find them).
  const widgets = new Set(field.acroField.getWidgets().map((w) => w.dict));
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) if (widgets.has(annots.lookup(i) as never)) annots.remove(i);
  }
  doc.getForm().removeField(field);
  return true;
}

/** How words will be written: in the PDF's own font when it has every letter, or else a built-in one. */
type WordsInk = { own: PageFont } | { font: PDFFont };

async function wordsInk(doc: PDFDocument, page: PDFPage, item: WordsItem): Promise<WordsInk> {
  const own = item.own ? pageFont(page, item.own.base) : null;
  if (own && lineStarts(item).every((l) => encodeWith(own.codes, l.text) !== null)) return { own };
  const bad = unwritable(item.font, item.text);
  if (bad) throw new AddProblem(`These letters can't be written with the built-in fonts (they cover English and most European letters): ${bad}`);
  return { font: await doc.embedFont(FONTS[item.font]) };
}

function drawWords(page: PDFPage, frame: ReturnType<typeof frameOf>, item: WordsItem, ink: WordsInk): Rect {
  const shownH = frame.rotation % 180 ? frame.width : frame.height;
  const [r, g, b] = hexToRgb(item.colour);
  if (item.cover) {
    // Changing words already there: cover the old ones first (with the colour behind them).
    const c = item.cover;
    const [cr, cg, cb] = hexToRgb(item.coverColour ?? "#ffffff");
    const at = toPageSpace(frame, c.x, shownH - (c.y + c.height), 0);
    page.drawRectangle({ x: at.x, y: at.y, width: c.width, height: c.height, color: rgb(cr, cg, cb), rotate: degrees(at.angle) });
  }
  let widest = 0;
  for (const line of lineStarts(item)) {
    const at = toPageSpace(frame, line.x, shownH - line.y, 0);
    if ("own" in ink) {
      const key = PDFName.of(ink.own.key);
      page.pushOperators(
        pushGraphicsState(),
        setFillingRgbColor(r, g, b),
        beginText(),
        setFontAndSize(key, item.size),
        rotateAndSkewTextDegreesAndTranslate(at.angle, 0, 0, at.x, at.y),
        showText(PDFHexString.of(encodeWith(ink.own.codes, line.text) as string)),
        endText(),
        popGraphicsState(),
      );
      widest = Math.max(widest, ink.own.widthOf(line.text, item.size));
    } else {
      page.drawText(line.text, { x: at.x, y: at.y, size: item.size, font: ink.font, color: rgb(r, g, b), rotate: degrees(at.angle) });
      widest = Math.max(widest, ink.font.widthOfTextAtSize(line.text, item.size));
    }
  }
  const box = { x: item.x, y: item.y, width: Math.max(widest, item.size), height: wordsHeight(item) };
  return item.cover ? unite(box, item.cover) : box;
}

const unite = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

function drawShape(page: PDFPage, frame: ReturnType<typeof frameOf>, item: ShapeItem): void {
  const { box, start, end, head } = shapeInPage(frame, item);
  const [r, g, b] = hexToRgb(item.colour);
  const color = rgb(r, g, b);
  const thickness = Math.max(0.25, item.thickness);
  const opacity = opacityOf(item);
  const fill = item.fill && canFill(item.shape) ? rgb(...hexToRgb(item.fill)) : undefined;
  switch (item.shape) {
    case "highlight":
      // Multiplied into the page, so the words under it stay crisp and dark.
      page.drawRectangle({ ...box, color, opacity, blendMode: BlendMode.Multiply });
      break;
    case "box":
      page.drawRectangle({ ...box, color: fill, opacity, borderColor: thickness > 0 ? color : undefined, borderWidth: thickness, borderOpacity: opacity });
      break;
    case "oval":
      page.drawEllipse({ x: box.x + box.width / 2, y: box.y + box.height / 2, xScale: box.width / 2, yScale: box.height / 2, color: fill, opacity, borderColor: color, borderWidth: thickness, borderOpacity: opacity });
      break;
    case "line":
    case "arrow":
      page.drawLine({ start, end, thickness, color, opacity, lineCap: LineCapStyle.Round });
      if (head) {
        // pdf-lib draws SVG paths with y running down from the given origin.
        page.drawSvgPath(`M ${head[0].x} ${-head[0].y} L ${head[1].x} ${-head[1].y} L ${head[2].x} ${-head[2].y} Z`, { x: 0, y: 0, color, opacity });
      }
      break;
  }
}

function drawInk(page: PDFPage, frame: ReturnType<typeof frameOf>, item: InkItem): void {
  const shownH = frame.rotation % 180 ? frame.width : frame.height;
  const [r, g, b] = hexToRgb(item.colour);
  const opacity = opacityOf(item);
  for (const stroke of item.strokes) {
    if (!stroke.length) continue;
    // In the page's own space, y flipped for pdf-lib's SVG paths (which run down from the origin).
    const pts = stroke.map(([x, y]) => {
      const p = toPageSpace(frame, x, shownH - y, 0);
      return [p.x, -p.y] as [number, number];
    });
    page.drawSvgPath(strokePath(pts), { x: 0, y: 0, borderColor: rgb(r, g, b), borderWidth: Math.max(0.25, item.thickness), borderOpacity: opacity, borderLineCap: LineCapStyle.Round });
  }
}

/**
 * Write words found in a page's pictures onto it, invisibly, each stretched
 * over the word it was read from, so the words can be picked, copied and
 * searched where they show. Letters the built-in font can't write are left out.
 */
export async function addHiddenWords(bytes: Uint8Array, page: number, words: HiddenWord[]): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  await writeHiddenWords(doc, pageOf(doc, page), words);
  return save(doc);
}

/** Write words invisibly onto a page (so they can be picked, copied and found), in front of what's there. */
export async function writeHiddenWords(doc: PDFDocument, p: PDFPage, words: HiddenWord[]): Promise<void> {
  if (!words.length) return;
  const font = await doc.embedFont(FONTS.Helvetica);
  const key = p.node.newFontDictionary(font.name, font.ref);
  const frame = frameOf(p);
  const shownH = frame.rotation % 180 ? frame.width : frame.height;
  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  for (const w of words) {
    const text = [...w.text].filter((ch) => !unwritable("Helvetica", ch)).join("");
    if (!text) continue;
    // Letters about as tall as the word's box; the baseline a fifth of the way up from its bottom.
    const size = Math.max(1, w.along ? w.along.size * 0.95 : w.height * 0.95);
    const natural = font.widthOfTextAtSize(text, size);
    const squeeze = natural > 0 ? Math.max(1, Math.min(1000, ((w.along ? w.along.length : w.width) / natural) * 100)) : 100;
    // Words that aren't level start where their baseline does, turned as they show (clockwise as shown is the other way in the PDF).
    const at = w.along ? toPageSpace(frame, w.along.x, shownH - w.along.y, -w.along.turn) : toPageSpace(frame, w.x, shownH - (w.y + w.height * 0.8), 0);
    ops.push(setFontAndSize(key, size), setCharacterSqueeze(squeeze), rotateAndSkewTextDegreesAndTranslate(at.angle, 0, 0, at.x, at.y), showText(font.encodeText(text)));
  }
  ops.push(endText(), popGraphicsState());
  const before = existingContents(p);
  p.pushOperators(...ops);
  arrange(p, before, false);
}

/** PNG or JPG, from the file's first bytes (null for anything else). */
export function pictureType(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

