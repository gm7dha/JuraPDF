/**
 * Signatures (pure): finding the ink in a drawing, turning a scanned
 * signature's white paper see-through, and the signatures kept on this
 * computer to use again.
 */

export interface SavedSignature {
  id: string;
  /** A PNG picture with a see-through background, as a data: link. */
  png: string;
  /** Its size in pixels. */
  width: number;
  height: number;
}

/** How many signatures are kept (the newest first). */
export const MOST_SAVED = 6;

/** The handwriting-like letters a typed signature can use (whichever the computer has; the browser's "cursive" otherwise). */
export const HANDWRITING: { name: string; css: string }[] = [
  { name: "Flowing", css: '"Segoe Script", "Snell Roundhand", "Brush Script MT", "Lucida Handwriting", cursive' },
  { name: "Neat", css: '"Bradley Hand", "Ink Free", "Segoe Print", "Comic Sans MS", cursive' },
  { name: "Formal", css: '"Apple Chancery", "Palace Script MT", "Monotype Corsiva", "URW Chancery L", cursive' },
];

/** The smallest box holding every pixel with any ink (alpha above `min`), or null for an empty drawing. */
export function inkBounds(rgba: Uint8ClampedArray, width: number, height: number, min = 8): { x: number; y: number; width: number; height: number } | null {
  let x1 = width;
  let y1 = height;
  let x2 = -1;
  let y2 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > min) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  return x2 < 0 ? null : { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
}

/**
 * Make paper see-through: white and near-white pixels vanish, dark ones stay
 * solid, and the greys between fade, so the edges of the pen strokes stay
 * smooth. Changes `rgba` in place.
 */
export function clearPaper(rgba: Uint8ClampedArray, paper = 230, ink = 150): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const light = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    const keep = light >= paper ? 0 : light <= ink ? 1 : (paper - light) / (paper - ink);
    rgba[i + 3] = Math.round(rgba[i + 3] * keep);
  }
}

/**
 * The size to give a signature when it's first put on a page, in "pixels" as
 * pictures are sized (¾ of a point each): about 160 points (5.6 cm) wide, less
 * if that would make it taller than 60 points.
 */
export function placingSize(width: number, height: number): { pixelsWide: number; pixelsHigh: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const points = Math.min(160, (60 * w) / h);
  const pixelsWide = points / 0.75;
  return { pixelsWide, pixelsHigh: (pixelsWide * h) / w };
}

/** The kept signatures from storage, with anything odd left out. */
export function cleanSaved(raw: unknown): SavedSignature[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is SavedSignature =>
        !!s &&
        typeof s === "object" &&
        typeof (s as SavedSignature).id === "string" &&
        typeof (s as SavedSignature).png === "string" &&
        (s as SavedSignature).png.startsWith("data:image/png;base64,") &&
        Number.isFinite((s as SavedSignature).width) &&
        Number.isFinite((s as SavedSignature).height),
    )
    .slice(0, MOST_SAVED);
}

/** Keep a new signature (newest first; the same picture isn't kept twice; the oldest go past MOST_SAVED). */
export function withSaved(list: readonly SavedSignature[], one: SavedSignature): SavedSignature[] {
  return [one, ...list.filter((s) => s.png !== one.png)].slice(0, MOST_SAVED);
}

/** The bytes of a data: link's base64 contents. */
export function dataUrlBytes(url: string): Uint8Array<ArrayBuffer> {
  const b64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * A picture `w` × `h` (any units) put in a box (a form's signature box): as large as fits with a little room
 * around it, in the middle, keeping its shape.
 */
export function fitInBox(w: number, h: number, box: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const room = Math.min(2, box.width / 10, box.height / 10);
  const fit = Math.min((box.width - room * 2) / Math.max(1, w), (box.height - room * 2) / Math.max(1, h));
  const width = Math.max(1, w * fit);
  const height = Math.max(1, h * fit);
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}
