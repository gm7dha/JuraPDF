/**
 * Changing a PDF's pages with pdf-lib: turn, delete, reorder, add blank pages,
 * bring pages in from another PDF, and save some pages as a new PDF. Each
 * gives back the new file. Pages are counted from 0.
 */
import { PDFDocument, degrees } from "pdf-lib";
import type { PictureFile } from "./additions";

import { normalRotation } from "../model/watermark";
import { LockedPdf, loadForEditing, saveEdited } from "./watermark";

/** Something about the request can't be done; the message says why. */
export class PageProblem extends Error {}

const save = saveEdited;

/** Turn pages a quarter turn clockwise (90) or anticlockwise (-90), or half a turn (180). */
export async function turnPages(bytes: Uint8Array, pages: number[], by: 90 | -90 | 180): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  for (const i of pages) {
    const page = doc.getPage(i);
    page.setRotation(degrees(normalRotation(page.getRotation().angle + by)));
  }
  return save(doc);
}

/** Delete pages (at least one page must stay). */
export async function deletePages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  const gone = [...new Set(pages)].filter((i) => i >= 0 && i < doc.getPageCount()).sort((a, b) => b - a);
  if (gone.length >= doc.getPageCount()) throw new PageProblem("A PDF needs at least one page, so the last page can't be deleted.");
  for (const i of gone) doc.removePage(i);
  return save(doc);
}

/** Put the pages in a new order (`order` lists the old page numbers in their new places). */
export async function reorderPages(bytes: Uint8Array, order: number[]): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  const pages = doc.getPages();
  if (order.length !== pages.length || new Set(order).size !== pages.length) throw new PageProblem("That page order doesn't fit this PDF.");
  for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
  for (const old of order) doc.addPage(pages[old]);
  return save(doc);
}

/** Add a blank page at place `at` (0 = the start), the size of the page beside it as shown. */
export async function addBlankPage(bytes: Uint8Array, at: number): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  const count = doc.getPageCount();
  const near = doc.getPage(Math.min(Math.max(0, at - 1), count - 1));
  const { width, height } = near.getSize();
  const turned = normalRotation(near.getRotation().angle) % 180 !== 0;
  doc.insertPage(Math.min(Math.max(0, at), count), turned ? [height, width] : [width, height]);
  return save(doc);
}

/** Bring every page of another PDF in at place `at`. Gives the new file and how many pages came in. */
export async function insertPdf(bytes: Uint8Array, other: Uint8Array, otherName: string, at: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; added: number }> {
  const doc = await loadForEditing(bytes);
  let source: PDFDocument;
  try {
    source = await loadForEditing(other);
  } catch (e) {
    if (e instanceof LockedPdf) throw new PageProblem(`${otherName} is locked with a password, so its pages can't be brought in.`);
    throw new PageProblem(`${otherName} couldn't be read as a PDF.`);
  }
  const copied = await doc.copyPages(source, source.getPageIndices());
  const start = Math.min(Math.max(0, at), doc.getPageCount());
  copied.forEach((page, k) => doc.insertPage(start + k, page));
  return { bytes: await save(doc), added: copied.length };
}

/** A new PDF of just these pages, in this order. */
export async function extractPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array<ArrayBuffer>> {
  const source = await loadForEditing(bytes);
  const doc = await PDFDocument.create();
  const copied = await doc.copyPages(source, pages);
  copied.forEach((p) => doc.addPage(p));
  return doc.save() as Promise<Uint8Array<ArrayBuffer>>;
}

/**
 * Bring pictures in as new pages at place `at`: each on a page the size of
 * the pages around it (turned to suit the picture's shape), filling it as far
 * as it can while keeping its own shape, in the middle.
 */
export async function insertPictures(bytes: Uint8Array, pictures: PictureFile[], at: number): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  const count = doc.getPageCount();
  const near = doc.getPage(Math.min(Math.max(0, at - 1), count - 1));
  const size = near.getSize();
  const turned = normalRotation(near.getRotation().angle) % 180 !== 0;
  const [w, h] = turned ? [size.height, size.width] : [size.width, size.height];
  let place = Math.min(Math.max(0, at), count);
  for (const picture of pictures) {
    let image;
    try {
      image = picture.type === "png" ? await doc.embedPng(picture.bytes) : await doc.embedJpg(picture.bytes);
    } catch {
      throw new PageProblem(`${picture.name} couldn't be read as a picture. Try a PNG or JPG.`);
    }
    const wide = image.width > image.height;
    const [pw, ph] = wide === w > h ? [w, h] : [h, w];
    const page = doc.insertPage(place++, [pw, ph]);
    const scale = Math.min(pw / image.width, ph / image.height);
    const iw = image.width * scale;
    const ih = image.height * scale;
    page.drawImage(image, { x: (pw - iw) / 2, y: (ph - ih) / 2, width: iw, height: ih });
  }
  return save(doc);
}
