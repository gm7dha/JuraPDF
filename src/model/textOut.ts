/** All the words of a PDF as plain text: one line per line of words, a blank line and a heading between pages. */

export interface TextBit {
  str: string;
  /** pdf.js marks the last bit on a line. */
  hasEOL?: boolean;
}

/** One page's words, line by line. */
export function pageText(bits: TextBit[]): string {
  let out = "";
  for (const b of bits) {
    out += b.str;
    if (b.hasEOL) out += "\n";
  }
  return out
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Every page's words, each under a "Page N" heading (pages are numbered from 1). */
export function documentText(pages: { page: number; text: string }[]): string {
  return pages.map((p) => `--- Page ${p.page} ---\n${p.text || "(no words on this page)"}`).join("\n\n") + "\n";
}
