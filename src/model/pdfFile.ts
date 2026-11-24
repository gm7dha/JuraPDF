/** Recognising PDF files and naming them. Pure, so it can be tested. */

export const PDF_MIME = "application/pdf";
export const PDF_EXTENSION = ".pdf";

/** True when the bytes start like a PDF ("%PDF-" within the first kilobyte, as readers allow). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 5 <= head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true;
  }
  return false;
}

/** True for a file name ending in .pdf (any case). */
export function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name.trim());
}

/** "Quarterly report.pdf" → "Quarterly report". */
export function nameFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.pdf$/i, "").trim() || "Untitled";
}

/** A friendly size: "820 KB", "3.4 MB". */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A page size in plain words: "A4", "Letter" or "210 × 297 mm" (sizes in points, either way round). */
export function paperName(width: number, height: number): string {
  const mm = (pt: number) => (pt * 25.4) / 72;
  const [w, h] = [mm(width), mm(height)];
  const [short, long] = w < h ? [w, h] : [h, w];
  const known: [string, number, number][] = [
    ["A3", 297, 420],
    ["A4", 210, 297],
    ["A5", 148, 210],
    ["Letter", 215.9, 279.4],
    ["Legal", 215.9, 355.6],
  ];
  const hit = known.find(([, s, l]) => Math.abs(short - s) < 2 && Math.abs(long - l) < 2);
  const turned = w > h ? " landscape" : "";
  if (hit) return `${hit[0]}${turned}`;
  return `${Math.round(w)} × ${Math.round(h)} mm`;
}
