/**
 * Making a PDF smaller, with pdf-lib: pictures bigger than the pages need are
 * brought down to size (JPG photos saved again a little more squeezed), parts
 * left over from earlier changes that nothing uses any more are dropped, and
 * the rest is stored packed together. Decoding and drawing pictures needs a
 * browser, so that part is handed in (`Painter`); without one (Claude's tools in
 * Node) only the tidying is done.
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFHexString, PDFString, decodePDFRawStream, type PDFObject, type PDFDocument } from "pdf-lib";

import { fromRgba, longestSideFor, shrunkSize, SQUEEZES, toRgba, undoPredictor, type Squeeze } from "../model/compress";
import { loadForEditing, saveEdited } from "./watermark";

/** A picture from inside the PDF, ready to be drawn by the browser. */
export type Picture = { kind: "jpg"; bytes: Uint8Array; width: number; height: number } | { kind: "pixels"; rgba: Uint8ClampedArray; width: number; height: number };

/** What the browser does: draw a picture at a new size, and save pixels as a JPG. */
export interface Painter {
  /** The picture drawn `width` × `height`, as red, green, blue, alpha. */
  pixels(picture: Picture, width: number, height: number): Promise<Uint8ClampedArray>;
  jpg(rgba: Uint8ClampedArray, width: number, height: number, quality: number): Promise<Uint8Array>;
}

export interface Squeezed {
  bytes: Uint8Array<ArrayBuffer>;
  /** How many pictures were made smaller. */
  pictures: number;
  /** How many leftover parts were dropped. */
  dropped: number;
}

const N = (name: string) => PDFName.of(name);

/** Drop everything nothing in the PDF points to any more (left over from earlier changes). */
export function dropUnused(doc: PDFDocument): number {
  const ctx = doc.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt, ctx.trailerInfo.ID].filter((o): o is PDFObject => !!o);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      const key = o.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const target = ctx.lookup(o);
      if (target) stack.push(target);
    } else if (o instanceof PDFDict) {
      for (const v of o.values()) stack.push(v);
    } else if (o instanceof PDFStream) {
      for (const v of o.dict.values()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) stack.push(o.get(i));
    }
  }
  // Encrypted PDFs aren't changed at all (they're turned away before this); nothing else is kept outside the tree.
  let dropped = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) {
      ctx.delete(ref);
      dropped++;
    }
  }
  return dropped;
}

function num(dict: PDFDict, key: string): number | undefined {
  const v = dict.lookup(N(key));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

function filters(dict: PDFDict): string[] {
  const f = dict.lookup(N("Filter"));
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map((x) => (x instanceof PDFName ? x.decodeText() : "?"));
  return [];
}

/** How a picture's colours are stored: grey, red-green-blue, numbered colours (with their palette), or something not handled here. */
function colours(doc: PDFDocument, cs: PDFObject | undefined): { channels: 1 | 3; palette?: Uint8Array } | null {
  const ctx = doc.context;
  const v = cs instanceof PDFRef ? ctx.lookup(cs) : cs;
  if (v instanceof PDFName) {
    const name = v.decodeText();
    return name === "DeviceGray" || name === "CalGray" ? { channels: 1 } : name === "DeviceRGB" || name === "CalRGB" ? { channels: 3 } : null;
  }
  if (!(v instanceof PDFArray) || v.size() < 1) return null;
  const kind = v.lookup(0);
  if (kind === N("ICCBased")) {
    const profile = v.lookup(1);
    const n = profile instanceof PDFStream ? num(profile.dict, "N") : undefined;
    return n === 1 ? { channels: 1 } : n === 3 ? { channels: 3 } : null;
  }
  if (kind === N("CalGray")) return { channels: 1 };
  if (kind === N("CalRGB")) return { channels: 3 };
  if (kind === N("Indexed") && v.size() >= 4) {
    const base = colours(doc, v.get(1));
    if (base?.channels !== 3 || base.palette) return null;
    const table = v.lookup(3);
    let palette: Uint8Array | null = null;
    if (table instanceof PDFString || table instanceof PDFHexString) palette = table.asBytes();
    else if (table instanceof PDFRawStream) palette = decodePDFRawStream(table).decode();
    return palette ? { channels: 1, palette } : null;
  }
  return null;
}

/** The images that make up pages (not see-through masks, which are left alone), by their place in the PDF. */
function pictures(doc: PDFDocument): [PDFRef, PDFRawStream][] {
  const all: [PDFRef, PDFRawStream][] = [];
  const masks = new Set<string>();
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.lookup(N("Subtype")) !== N("Image")) continue;
    all.push([ref, obj]);
    const mask = obj.dict.get(N("SMask"));
    if (mask instanceof PDFRef) masks.add(mask.toString());
  }
  return all.filter(([ref]) => !masks.has(ref.toString()));
}

/** A picture ready to draw, or null when it's stored in a way this doesn't handle (it's left as it is). */
function readPicture(doc: PDFDocument, stream: PDFRawStream): { picture: Picture; gray: boolean; jpg: boolean } | null {
  const d = stream.dict;
  const width = num(d, "Width") ?? 0;
  const height = num(d, "Height") ?? 0;
  if (width < 1 || height < 1) return null;
  // Masks, colour-keyed see-through, and pictures with their colours turned round are left alone.
  if (d.lookup(N("ImageMask")) || d.lookup(N("Mask")) instanceof PDFArray || d.lookup(N("Decode"))) return null;
  const how = colours(doc, d.get(N("ColorSpace")));
  if (!how) return null;
  const f = filters(d);
  if (f.length === 1 && f[0] === "DCTDecode") {
    if (num(d, "BitsPerComponent") !== 8 || how.palette) return null;
    return { picture: { kind: "jpg", bytes: stream.contents, width, height }, gray: how.channels === 1, jpg: true };
  }
  if (f.some((x) => !["FlateDecode", "LZWDecode", "ASCIIHexDecode", "ASCII85Decode", "RunLengthDecode"].includes(x))) return null;
  if (num(d, "BitsPerComponent") !== 8) return null;
  let data = decodePDFRawStream(stream).decode();
  const parms = d.lookup(N("DecodeParms"));
  const p = parms instanceof PDFDict ? parms : parms instanceof PDFArray ? parms.lookup(parms.size() - 1) : undefined;
  const predictor = p instanceof PDFDict ? num(p, "Predictor") ?? 1 : 1;
  if (predictor >= 10) {
    const undone = undoPredictor(data, width, how.channels, 8);
    if (!undone) return null;
    data = undone;
  } else if (predictor !== 1) return null;
  const rgba = toRgba(data, how.channels, width, height, how.palette);
  return rgba ? { picture: { kind: "pixels", rgba, width, height }, gray: how.channels === 1 && !how.palette, jpg: false } : null;
}

/**
 * The PDF made smaller. `painter` draws pictures (the browser's); without one only
 * the tidying is done. `progress` hears how far along it is (0–1).
 */
export async function squeeze(bytes: Uint8Array, level: Squeeze, painter?: Painter, progress?: (done: number) => void): Promise<Squeezed> {
  const doc = await loadForEditing(bytes);
  const dropped = dropUnused(doc);
  const s = SQUEEZES[level];
  const longest = longestSideFor(
    doc.getPages().map((p) => {
      const { width, height } = p.getSize();
      return [width, height] as const;
    }),
    s.dpi,
  );
  let shrunk = 0;
  const list = painter ? pictures(doc) : [];
  for (let i = 0; i < list.length; i++) {
    const [ref, stream] = list[i];
    progress?.(i / list.length);
    try {
      const read = readPicture(doc, stream);
      if (!read) continue;
      const { picture, gray, jpg } = read;
      const size = shrunkSize(picture.width, picture.height, longest);
      // A JPG is saved again more squeezed even at its own size; other pictures only change if they're too big (or for "as small as possible").
      if (!size && !jpg && !s.photosToJpg) continue;
      const { width, height } = size ?? picture;
      const rgba = await painter!.pixels(picture, width, height);
      const old = stream.contents.length;
      const asJpg = jpg || s.photosToJpg ? await painter!.jpg(rgba, width, height, s.quality) : null;
      const asPixels = !jpg && size ? doc.context.flateStream(fromRgba(rgba, gray), {}) : null;
      // Whichever is smaller (a JPG only when it's clearly smaller: it isn't as sharp).
      const useJpg = asJpg && (!asPixels || asJpg.length < asPixels.contents.length * 0.7) ? asJpg : null;
      const newSize = useJpg ? useJpg.length : asPixels ? asPixels.contents.length : Infinity;
      if (newSize > old * 0.9) continue;
      const dict = stream.dict.clone(doc.context);
      for (const key of ["Filter", "DecodeParms", "Length", "DL"]) dict.delete(N(key));
      dict.set(N("Width"), PDFNumber.of(width));
      dict.set(N("Height"), PDFNumber.of(height));
      dict.set(N("BitsPerComponent"), PDFNumber.of(8));
      if (useJpg) {
        dict.set(N("ColorSpace"), N("DeviceRGB"));
        dict.set(N("Filter"), N("DCTDecode"));
        doc.context.assign(ref, PDFRawStream.of(dict, useJpg));
      } else if (asPixels) {
        dict.set(N("ColorSpace"), N(gray ? "DeviceGray" : "DeviceRGB"));
        dict.set(N("Filter"), N("FlateDecode"));
        doc.context.assign(ref, PDFRawStream.of(dict, asPixels.contents));
      }
      shrunk++;
    } catch {
      // A picture that can't be read or drawn is left as it was.
    }
  }
  progress?.(1);
  return { bytes: await saveEdited(doc, { useObjectStreams: true }), pictures: shrunk, dropped };
}
