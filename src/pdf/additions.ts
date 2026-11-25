/**
 * Writing words and pictures onto a page, with pdf-lib (in the browser and in
 * Node for the tests and Claude). Where things go is worked out in
 * src/model/additions.ts.
 */
import {
  BlendMode,
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

import { HIGHLIGHT_OPACITY, lineStarts, shapeInPage, linesOf, type PictureItem, type ShapeItem, type WordsItem } from "../model/additions";
import type { HiddenWord } from "../model/ocr";
import { hexToRgb, toPageSpace, type FontChoice } from "../model/watermark";
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

const save = saveEdited;

function pageOf(doc: Awaited<ReturnType<typeof loadForEditing>>, n: number) {
  if (n < 0 || n >= doc.getPageCount()) throw new AddProblem(`This PDF has no page ${n + 1}.`);
  return doc.getPage(n);
}

/** Write words onto their page. Gives the new file. */
export async function addWords(bytes: Uint8Array, item: WordsItem): Promise<Uint8Array<ArrayBuffer>> {
  if (!linesOf(item.text).length && !item.cover) throw new AddProblem("Type some words first.");
  const bad = unwritable(item.font, item.text);
  if (bad) throw new AddProblem(`These letters can't be written with the built-in fonts (they cover English and most European letters): ${bad}`);
  const doc = await loadForEditing(bytes);
  const page = pageOf(doc, item.page);
  const font = await doc.embedFont(FONTS[item.font]);
  const frame = frameOf(page);
  const shownH = frame.rotation % 180 ? frame.width : frame.height;
  const [r, g, b] = hexToRgb(item.colour);
  const before = existingContents(page);
  if (item.cover) {
    // Changing words already there: cover the old ones with white first.
    const c = item.cover;
    const at = toPageSpace(frame, c.x, shownH - (c.y + c.height), 0);
    page.drawRectangle({ x: at.x, y: at.y, width: c.width, height: c.height, color: rgb(1, 1, 1), rotate: degrees(at.angle) });
  }
  for (const line of lineStarts(item)) {
    const at = toPageSpace(frame, line.x, shownH - line.y, 0);
    page.drawText(line.text, { x: at.x, y: at.y, size: item.size, font, color: rgb(r, g, b), rotate: degrees(at.angle) });
  }
  arrange(page, before, false);
  return save(doc);
}

/** A picture's file. */
export interface PictureFile {
  bytes: Uint8Array;
  type: "png" | "jpg";
  name: string;
}

/** Put a picture onto its page. Gives the new file. */
export async function addPicture(bytes: Uint8Array, item: PictureItem, picture: PictureFile): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  const page = pageOf(doc, item.page);
  let image;
  try {
    image = picture.type === "png" ? await doc.embedPng(picture.bytes) : await doc.embedJpg(picture.bytes);
  } catch {
    throw new AddProblem(`${picture.name} couldn't be read as a picture. Try a PNG or JPG.`);
  }
  const frame = frameOf(page);
  const shownH = frame.rotation % 180 ? frame.width : frame.height;
  const before = existingContents(page);
  // pdf-lib turns a picture about its bottom-left corner, so start from that corner as shown.
  const at = toPageSpace(frame, item.x, shownH - (item.y + item.height), 0);
  page.drawImage(image, { x: at.x, y: at.y, width: item.width, height: item.height, rotate: degrees(at.angle) });
  arrange(page, before, false);
  return save(doc);
}

/** Draw a highlight, box, oval, line or arrow on its page. Gives the new file. */
export async function addShape(bytes: Uint8Array, item: ShapeItem): Promise<Uint8Array<ArrayBuffer>> {
  return addShapes(bytes, [item]);
}

/** Several shapes at once (e.g. a highlight over each line of the words picked), as one change. */
export async function addShapes(bytes: Uint8Array, items: ShapeItem[]): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  for (const index of [...new Set(items.map((i) => i.page))]) {
    const page = pageOf(doc, index);
    const frame = frameOf(page);
    const before = existingContents(page);
    for (const item of items.filter((i) => i.page === index)) drawShape(page, frame, item);
    arrange(page, before, false);
  }
  return save(doc);
}

function drawShape(page: PDFPage, frame: ReturnType<typeof frameOf>, item: ShapeItem): void {
  const { box, start, end, head } = shapeInPage(frame, item);
  const [r, g, b] = hexToRgb(item.colour);
  const color = rgb(r, g, b);
  const thickness = Math.max(0.25, item.thickness);
  switch (item.shape) {
    case "highlight":
      // Multiplied into the page, so the words under it stay crisp and dark.
      page.drawRectangle({ ...box, color, opacity: HIGHLIGHT_OPACITY, blendMode: BlendMode.Multiply });
      break;
    case "box":
      page.drawRectangle({ ...box, borderColor: color, borderWidth: thickness });
      break;
    case "oval":
      page.drawEllipse({ x: box.x + box.width / 2, y: box.y + box.height / 2, xScale: box.width / 2, yScale: box.height / 2, borderColor: color, borderWidth: thickness });
      break;
    case "line":
    case "arrow":
      page.drawLine({ start, end, thickness, color, lineCap: LineCapStyle.Round });
      if (head) {
        // pdf-lib draws SVG paths with y running down from the given origin.
        page.drawSvgPath(`M ${head[0].x} ${-head[0].y} L ${head[1].x} ${-head[1].y} L ${head[2].x} ${-head[2].y} Z`, { x: 0, y: 0, color });
      }
      break;
  }
}

/**
 * Write words found in a page's pictures onto it, invisibly, each stretched
 * over the word it was read from, so the words can be picked, copied and
 * searched where they show. Letters the built-in font can't write are left out.
 */
export async function addHiddenWords(bytes: Uint8Array, page: number, words: HiddenWord[]): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  const p = pageOf(doc, page);
  const font = await doc.embedFont(FONTS.Helvetica);
  const key = p.node.newFontDictionary(font.name, font.ref);
  const frame = frameOf(p);
  const shownH = frame.rotation % 180 ? frame.width : frame.height;
  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  for (const w of words) {
    const text = [...w.text].filter((ch) => !unwritable("Helvetica", ch)).join("");
    if (!text) continue;
    // Letters about as tall as the word's box; the baseline a fifth of the way up from its bottom.
    const size = Math.max(1, w.height * 0.95);
    const natural = font.widthOfTextAtSize(text, size);
    const squeeze = natural > 0 ? Math.max(1, Math.min(1000, (w.width / natural) * 100)) : 100;
    const at = toPageSpace(frame, w.x, shownH - (w.y + w.height * 0.8), 0);
    ops.push(setFontAndSize(key, size), setCharacterSqueeze(squeeze), rotateAndSkewTextDegreesAndTranslate(at.angle, 0, 0, at.x, at.y), showText(font.encodeText(text)));
  }
  ops.push(endText(), popGraphicsState());
  const before = existingContents(p);
  p.pushOperators(...ops);
  arrange(p, before, false);
  return save(doc);
}

/** PNG or JPG, from the file's first bytes (null for anything else). */
export function pictureType(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

