/**
 * Writing a watermark into a PDF, with pdf-lib. Runs in the browser and in
 * Node (for the tests). The layout maths is in src/model/watermark.ts.
 */
import { EncryptedPDFError, PDFArray, PDFDocument, PDFFont, PDFImage, PDFName, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";

import {
  angleFor,
  choosePages,
  fitScale,
  hexToRgb,
  shownSize,
  stampsFor,
  startCorner,
  toPageSpace,
  type FontChoice,
  type PageFrame,
  type WatermarkSettings,
} from "../model/watermark";

/** A picture for a picture watermark. */
export interface WatermarkPicture {
  bytes: Uint8Array;
  type: "png" | "jpg";
  name: string;
}

/** The PDF is locked against changes (it has a password or owner restrictions). */
export class LockedPdf extends Error {
  constructor() {
    super("This PDF is locked against changes, so a watermark can't be saved into it. You can still print it with a watermark.");
  }
}

/** Something about the choices stops the watermark being made; the message says what. */
export class WatermarkProblem extends Error {}

const FONTS: Record<FontChoice, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  HelveticaBold: StandardFonts.HelveticaBold,
  TimesRoman: StandardFonts.TimesRoman,
  TimesRomanBold: StandardFonts.TimesRomanBold,
  Courier: StandardFonts.Courier,
  CourierBold: StandardFonts.CourierBold,
};

/** Open a PDF for changing. */
export async function loadForEditing(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (e instanceof EncryptedPDFError || (e instanceof Error && /encrypted/i.test(e.message))) throw new LockedPdf();
    throw e;
  }
}

/** What a watermark needs ready before it's written onto pages. */
interface Ink {
  font?: PDFFont;
  image?: PDFImage;
}

async function prepare(doc: PDFDocument, s: WatermarkSettings, picture?: WatermarkPicture): Promise<Ink> {
  if (s.kind === "picture") {
    if (!picture) throw new WatermarkProblem("Choose a picture for the watermark first.");
    try {
      return { image: picture.type === "png" ? await doc.embedPng(picture.bytes) : await doc.embedJpg(picture.bytes) };
    } catch {
      throw new WatermarkProblem(`${picture.name} couldn't be read as a picture. Try a PNG or JPG.`);
    }
  }
  const text = s.text.trim();
  if (!text) throw new WatermarkProblem("Type the words for the watermark first.");
  const font = await doc.embedFont(FONTS[s.font]);
  try {
    font.encodeText(text);
  } catch {
    throw new WatermarkProblem("Some of those letters can't be written with the built-in fonts (they cover English and most European letters). Try other words.");
  }
  return { font };
}

function frameOf(page: PDFPage): PageFrame {
  const box = page.getCropBox();
  return { x: box.x, y: box.y, width: box.width, height: box.height, rotation: page.getRotation().angle };
}

/** Write the watermark onto one page. */
function stampPage(page: PDFPage, s: WatermarkSettings, ink: Ink): void {
  const frame = frameOf(page);
  const [pw, ph] = shownSize(frame);
  const deg = angleFor(s, pw, ph);
  const opacity = Math.max(0.05, 1 - s.seeThrough / 100);

  // The item's size, as shown.
  let w: number;
  let h: number;
  let size = 0;
  if (ink.font) {
    const text = s.text.trim();
    const unitW = ink.font.widthOfTextAtSize(text, 1);
    const unitH = ink.font.heightAtSize(1, { descender: false });
    size = s.sizeMode === "fit" ? fitScale(unitW, unitH, deg, pw, ph) : s.size;
    w = unitW * size;
    h = unitH * size;
  } else if (ink.image) {
    w = (pw * s.pictureWidth) / 100;
    h = (w * ink.image.height) / ink.image.width;
  } else return;

  const contents = existingContents(page);
  for (const stamp of stampsFor(s.placement, w, h, deg, pw, ph)) {
    const at = toPageSpace(frame, stamp.x, stamp.y, stamp.angle);
    const [x, y] = startCorner(at.x, at.y, w, h, at.angle);
    if (ink.font) {
      const [r, g, b] = hexToRgb(s.colour);
      page.drawText(s.text.trim(), { x, y, size, font: ink.font, color: rgb(r, g, b), opacity, rotate: degrees(at.angle) });
    } else if (ink.image) {
      page.drawImage(ink.image, { x, y, width: w, height: h, opacity, rotate: degrees(at.angle) });
    }
  }
  arrange(page, contents, s.behind);
}

/** The page's own drawing instructions before the watermark was added (as a list). */
function existingContents(page: PDFPage): number {
  page.node.normalize();
  const contents = page.node.lookup(PDFName.of("Contents"));
  return contents instanceof PDFArray ? contents.size() : 0;
}

/**
 * Put the watermark's drawing behind or in front of the page's own. In front,
 * the page's own drawing is wrapped so any settings it leaves behind (a
 * shift, a colour) can't move or recolour the watermark.
 */
function arrange(page: PDFPage, before: number, behind: boolean): void {
  const contents = page.node.lookup(PDFName.of("Contents"));
  if (!(contents instanceof PDFArray)) return;
  const all = contents.asArray();
  const own = all.slice(0, before);
  const mark = all.slice(before);
  const ctx = page.doc.context;
  const q = ctx.register(ctx.flateStream("q\n"));
  const Q = ctx.register(ctx.flateStream("\nQ\n"));
  const order = behind ? [...mark, q, ...own, Q] : [q, ...own, Q, ...mark];
  while (contents.size() > 0) contents.remove(0);
  for (const item of order) contents.push(item);
}

/**
 * Add the watermark to the PDF and give back the new file. `only` limits it to
 * those pages (1-based) instead of the ones chosen in the settings.
 */
export async function addWatermark(bytes: Uint8Array, s: WatermarkSettings, picture?: WatermarkPicture, only?: number[]): Promise<{ bytes: Uint8Array; pages: number[] }> {
  const doc = await loadForEditing(bytes);
  const chosen = only ? { pages: only } : choosePages(s, doc.getPageCount());
  if ("error" in chosen) throw new WatermarkProblem(chosen.error);
  const ink = await prepare(doc, s, picture);
  const pages = doc.getPages();
  for (const n of chosen.pages) {
    const page = pages[n - 1];
    if (page) stampPage(page, s, ink);
  }
  return { bytes: await doc.save(), pages: chosen.pages };
}

/**
 * A one-page PDF of page `n` (1-based) with the watermark on, for the
 * preview. Quicker than watermarking the whole file for every change.
 */
export async function previewPage(source: PDFDocument, n: number, s: WatermarkSettings, picture?: WatermarkPicture): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [page] = await doc.copyPages(source, [n - 1]);
  doc.addPage(page);
  const ink = await prepare(doc, s, picture);
  stampPage(page, s, ink);
  return doc.save();
}
