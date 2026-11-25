/**
 * Writing words and pictures onto a page, with pdf-lib (in the browser and in
 * Node for the tests and Claude). Where things go is worked out in
 * src/model/additions.ts.
 */
import { StandardFontEmbedder, degrees, rgb } from "pdf-lib";

import { lineStarts, linesOf, type PictureItem, type WordsItem } from "../model/additions";
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
  if (!linesOf(item.text).length) throw new AddProblem("Type some words first.");
  const bad = unwritable(item.font, item.text);
  if (bad) throw new AddProblem(`These letters can't be written with the built-in fonts (they cover English and most European letters): ${bad}`);
  const doc = await loadForEditing(bytes);
  const page = pageOf(doc, item.page);
  const font = await doc.embedFont(FONTS[item.font]);
  const frame = frameOf(page);
  const shownH = frame.rotation % 180 ? frame.width : frame.height;
  const [r, g, b] = hexToRgb(item.colour);
  const before = existingContents(page);
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

/** PNG or JPG, from the file's first bytes (null for anything else). */
export function pictureType(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

