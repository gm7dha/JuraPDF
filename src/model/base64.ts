/** Base64 (bytes as text, for sending a PDF over the live link), written out here so it is the same in Node and every browser. Pure. */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_VALUE = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_VALUE[B64.charCodeAt(i)] = i;
// The web-safe letters too.
B64_VALUE["-".charCodeAt(0)] = 62;
B64_VALUE["_".charCodeAt(0)] = 63;

const B64_CODE = Uint8Array.from(B64, (c) => c.charCodeAt(0));
const PAD = "=".charCodeAt(0);

/** Bytes as base64 text. */
export function bytesToBase64(bytes: Uint8Array): string {
  // Written as letter codes into a buffer and turned into text a chunk at a time: many times quicker for long recordings than adding letter to letter.
  const CHUNK = 3 * 16384;
  const decoder = new TextDecoder("latin1");
  const codes = new Uint8Array((CHUNK / 3) * 4);
  const parts: string[] = [];
  for (let from = 0; from < bytes.length; from += CHUNK) {
    const to = Math.min(bytes.length, from + CHUNK);
    let at = 0;
    let i = from;
    for (; i + 2 < to; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      codes[at++] = B64_CODE[n >> 18];
      codes[at++] = B64_CODE[(n >> 12) & 63];
      codes[at++] = B64_CODE[(n >> 6) & 63];
      codes[at++] = B64_CODE[n & 63];
    }
    if (i < to) {
      const n = (bytes[i] << 16) | (i + 1 < to ? bytes[i + 1] << 8 : 0);
      codes[at++] = B64_CODE[n >> 18];
      codes[at++] = B64_CODE[(n >> 12) & 63];
      codes[at++] = i + 1 < to ? B64_CODE[(n >> 6) & 63] : PAD;
      codes[at++] = PAD;
    }
    parts.push(decoder.decode(codes.subarray(0, at)));
  }
  return parts.join("");
}

/** Base64 text back as bytes (spaces and line breaks ignored), or null when it isn't base64. */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> | null {
  let end = base64.length;
  while (end > 0 && (base64[end - 1] === "=" || base64.charCodeAt(end - 1) <= 32)) end--;
  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let bits = 0;
  let have = 0;
  let at = 0;
  for (let i = 0; i < end; i++) {
    const code = base64.charCodeAt(i);
    if (code <= 32) continue;
    const value = code < 128 ? B64_VALUE[code] : -1;
    if (value < 0) return null;
    bits = (bits << 6) | value;
    have += 6;
    if (have >= 8) {
      have -= 8;
      out[at++] = (bits >> have) & 255;
    }
  }
  // Six left-over bits can't be a byte: the text was cut short.
  if (have >= 6) return null;
  return at === out.length ? out : out.slice(0, at);
}
