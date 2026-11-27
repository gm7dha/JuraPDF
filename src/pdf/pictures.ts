/**
 * Pictures already on a page: find where each is drawn, and move, resize,
 * swap or remove one by changing that one drawing command in the page's
 * instructions (everything else on the page is left exactly as it was).
 */
import { PDFArray, PDFContentStream, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, type PDFPage } from "pdf-lib";

import type { Rect } from "../model/additions";
import { parseContent, splice } from "../model/contentStream";
import { IDENTITY, fitInside, matrixText, moveMatrix, multiply, placeMatrix, shownBox, type Matrix } from "../model/pictures";
import { AddProblem, type PictureFile } from "./additions";
import { frameOf, loadForEditing, saveEdited } from "./watermark";

/** A picture drawn on a page. */
export interface PictureSpot {
  /** Which picture-drawing command it is on the page (0 = the first). */
  n: number;
  /** Its name in the page's list of pictures. */
  name: string;
  /** Where it shows: points from the shown page's top-left. */
  box: Rect;
  pixelsWide: number;
  pixelsHigh: number;
}

interface Found extends PictureSpot {
  ctm: Matrix;
  start: number;
  end: number;
}

/** All of a page's drawing instructions as one run of bytes. */
export function contentOf(page: PDFPage): Uint8Array {
  const ctx = page.doc.context;
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : contents ? [contents] : [];
  const parts: Uint8Array[] = [];
  for (const s of streams) {
    if (s instanceof PDFRawStream) parts.push(decodePDFRawStream(s).decode());
    else if (s instanceof PDFContentStream) parts.push(s.getUnencodedContents());
    parts.push(new Uint8Array([0x0a]));
  }
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}

/** The page's pictures (by name), with their pixel sizes. */
function picturesByName(page: PDFPage): Map<string, { w: number; h: number }> {
  const out = new Map<string, { w: number; h: number }>();
  page.node.normalize();
  const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return out;
  for (const [key, value] of xobjects.entries()) {
    const obj = value instanceof PDFRef ? page.doc.context.lookup(value) : value;
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict?.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const num = (k: string) => (dict.lookupMaybe(PDFName.of(k), PDFNumber)?.asNumber() ?? 0);
    out.set(key.decodeText(), { w: num("Width"), h: num("Height") });
  }
  return out;
}

function find(page: PDFPage, content: Uint8Array): Found[] {
  const images = picturesByName(page);
  const frame = frameOf(page);
  const found: Found[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  for (const op of parseContent(content)) {
    if (op.op === "q") stack.push(ctm);
    else if (op.op === "Q") ctm = stack.pop() ?? IDENTITY;
    else if (op.op === "cm" && op.args.length === 6 && op.args.every((a) => typeof a === "number")) ctm = multiply(op.args as Matrix, ctm);
    else if (op.op === "Do" && typeof op.args[0] === "string") {
      const name = op.args[0].slice(1);
      const size = images.get(name);
      if (!size) continue;
      found.push({ n: found.length, name, box: shownBox(frame, ctm), pixelsWide: size.w, pixelsHigh: size.h, ctm, start: op.start, end: op.end });
    }
  }
  return found;
}

/** The pictures drawn on page `page` (from 0). */
export async function picturesOn(bytes: Uint8Array, page: number): Promise<PictureSpot[]> {
  const doc = await loadForEditing(bytes);
  if (page < 0 || page >= doc.getPageCount()) return [];
  const p = doc.getPage(page);
  return find(p, contentOf(p)).map(({ n, name, box, pixelsWide, pixelsHigh }) => ({ n, name, box, pixelsWide, pixelsHigh }));
}

export type PictureChange = { kind: "move"; to: Rect } | { kind: "remove" } | { kind: "replace"; picture: PictureFile; to: Rect };

/** Change picture `n` on page `page`: move or size it, take it off, or swap it for another picture. */
export async function changePicture(bytes: Uint8Array, page: number, n: number, change: PictureChange): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  if (page < 0 || page >= doc.getPageCount()) throw new AddProblem(`This PDF has no page ${page + 1}.`);
  const p = doc.getPage(page);
  const content = contentOf(p);
  const spot = find(p, content)[n];
  if (!spot) throw new AddProblem("That picture couldn't be found on the page any more.");
  const frame = frameOf(p);
  let text: string;
  if (change.kind === "remove") text = "";
  else if (change.kind === "move") text = `q ${matrixText(moveMatrix(frame, spot.ctm, spot.box, change.to))} cm ${PDFName.of(spot.name).asString()} Do Q`;
  else {
    let image;
    try {
      image = change.picture.type === "png" ? await doc.embedPng(change.picture.bytes) : await doc.embedJpg(change.picture.bytes);
    } catch {
      throw new AddProblem(`${change.picture.name} couldn't be read as a picture. Try a PNG or JPG.`);
    }
    const name = p.node.newXObject("Picture", image.ref).asString();
    // The new picture keeps its own shape, centred in the box asked for, drawn upright as the page shows.
    const box = fitInside(change.to, image.width, image.height);
    text = `q ${matrixText(placeMatrix(frame, spot.ctm, box))} cm ${name} Do Q`;
  }
  const ctx = doc.context;
  p.node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream(splice(content, [{ start: spot.start, end: spot.end, text }]))));
  return saveEdited(doc);
}
