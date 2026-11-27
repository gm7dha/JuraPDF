/**
 * Making a PDF smaller (pure): how small each choice makes pictures, the size
 * a picture is brought down to, unpacking the way pictures are stored inside
 * PDFs, and saying how much was saved.
 */

export type Squeeze = "light" | "medium" | "strong";

export interface SqueezeLevel {
  name: string;
  /** What it's good for, in a few words. */
  about: string;
  /** Pictures are kept sharp enough for this many dots to the inch on the largest page. */
  dpi: number;
  /** JPG quality, 0–1. */
  quality: number;
  /** Also turn other pictures (not already JPG) into JPG when that's much smaller: photos shrink a lot, but sharp drawings may go a little blurry. */
  photosToJpg: boolean;
}

export const SQUEEZES: Record<Squeeze, SqueezeLevel> = {
  light: { name: "A little", about: "Best for printing: pictures stay sharp (200 dots to the inch).", dpi: 200, quality: 0.85, photosToJpg: false },
  medium: { name: "Medium", about: "Good on screen and fine to print (150 dots to the inch).", dpi: 150, quality: 0.75, photosToJpg: false },
  strong: { name: "As small as possible", about: "For email and the web: pictures get softer (96 dots to the inch).", dpi: 96, quality: 0.6, photosToJpg: true },
};

export const DEFAULT_SQUEEZE: Squeeze = "medium";

/** The longest side, in pixels, that a picture needs for `dpi` on pages this big (sizes in points). */
export function longestSideFor(pageSizes: readonly (readonly [number, number])[], dpi: number): number {
  const most = pageSizes.reduce((m, [w, h]) => Math.max(m, w, h), 0) || 842;
  return Math.ceil((most / 72) * dpi);
}

/** The size to bring a picture down to (keeping its shape), or null when it's small enough already. */
export function shrunkSize(width: number, height: number, longest: number): { width: number; height: number } | null {
  const side = Math.max(width, height);
  // Not worth it for a little: only when it's at least a fifth too big.
  if (side <= longest * 1.2) return null;
  const k = longest / side;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * Undo the "PNG predictors" pictures are often stored with (each row stored
 * as its difference from the row above, or the pixel to the left…). `data` is
 * one byte saying how, then the row, for every row. Null when it doesn't fit.
 */
export function undoPredictor(data: Uint8Array, columns: number, colors: number, bitsPerComponent: number): Uint8Array | null {
  const bpp = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowBytes = Math.ceil((columns * colors * bitsPerComponent) / 8);
  const rows = Math.floor(data.length / (rowBytes + 1));
  if (!rows) return null;
  const out = new Uint8Array(rows * rowBytes);
  for (let r = 0; r < rows; r++) {
    const kind = data[r * (rowBytes + 1)];
    const src = r * (rowBytes + 1) + 1;
    const at = r * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const raw = data[src + i];
      const left = i >= bpp ? out[at + i - bpp] : 0;
      const up = r ? out[at - rowBytes + i] : 0;
      const upLeft = r && i >= bpp ? out[at - rowBytes + i - bpp] : 0;
      let v: number;
      if (kind === 0) v = raw;
      else if (kind === 1) v = raw + left;
      else if (kind === 2) v = raw + up;
      else if (kind === 3) v = raw + ((left + up) >> 1);
      else if (kind === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else return null;
      out[at + i] = v & 255;
    }
  }
  return out;
}

/**
 * Pixels stored 8 bits a colour (1 = grey, 3 = red green blue; `palette` for
 * a picture of numbered colours, three bytes a colour) → red, green, blue,
 * alpha. Null when there aren't enough bytes.
 */
export function toRgba(pixels: Uint8Array, channels: 1 | 3, width: number, height: number, palette?: Uint8Array): Uint8ClampedArray | null {
  const n = width * height;
  if (pixels.length < n * channels) return null;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    let r: number;
    let g: number;
    let b: number;
    if (palette) {
      const k = pixels[i] * 3;
      [r, g, b] = [palette[k] ?? 0, palette[k + 1] ?? 0, palette[k + 2] ?? 0];
    } else if (channels === 1) r = g = b = pixels[i];
    else [r, g, b] = [pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Red, green, blue, alpha → 1 byte (grey) or 3 bytes a pixel, as PDFs store them. */
export function fromRgba(rgba: Uint8ClampedArray, gray: boolean): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * (gray ? 1 : 3));
  for (let i = 0; i < n; i++) {
    if (gray) out[i] = rgba[i * 4];
    else {
      out[i * 3] = rgba[i * 4];
      out[i * 3 + 1] = rgba[i * 4 + 1];
      out[i * 3 + 2] = rgba[i * 4 + 2];
    }
  }
  return out;
}

/** "12.4 MB → 3.1 MB (75% smaller)", or a kind word when it couldn't be made smaller. */
export function savingLabel(before: number, after: number, sizeLabel: (n: number) => string): string {
  if (after >= before) return `It's already as small as it can be made here (${sizeLabel(before)}).`;
  const pct = Math.round((1 - after / before) * 100);
  return `${sizeLabel(before)} → ${sizeLabel(after)} (${pct < 1 ? "a little" : `${pct}%`} smaller)`;
}

/**
 * Whether a JPG carries camera notes (EXIF), which may say "turn me": the
 * browser would turn it when drawing it but PDF readers don't, so such JPGs
 * are left as they are.
 */
export function hasCameraNotes(jpg: Uint8Array): boolean {
  let i = 2;
  while (i + 4 < jpg.length && jpg[i] === 0xff) {
    const marker = jpg[i + 1];
    const length = (jpg[i + 2] << 8) | jpg[i + 3];
    if (marker === 0xe1 && jpg[i + 4] === 0x45 && jpg[i + 5] === 0x78 && jpg[i + 6] === 0x69 && jpg[i + 7] === 0x66) return true;
    // Pictures start at "start of scan": no more notes after that.
    if (marker === 0xda) return false;
    i += 2 + length;
  }
  return false;
}
