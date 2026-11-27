/**
 * Which letters a font already in a PDF can write, and the codes that write
 * them. Pure. A PDF's font says which letter each code shows (its "ToUnicode"
 * list, or a standard list such as WinAnsi); turned round, that gives the code
 * to write for each letter typed. Fonts carried in a PDF often hold only the
 * letters it uses, so a letter it lacks can't be written in it.
 */

/** Letter → code (as hex: two digits for one-byte fonts, four for two-byte ones). */
export type CodeMap = Map<string, string>;

const hexText = (hex: string): string => {
  const units: number[] = [];
  for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
  if (hex.length % 4 === 2) units.push(parseInt(hex.slice(-2), 16));
  return String.fromCharCode(...units);
};

/**
 * Read a ToUnicode list (a "CMap": `bfchar` and `bfrange` sections) into
 * letter → code, for single letters only. `bytes` is 1 or 2, how many bytes
 * each code takes. Where two codes show the same letter, the first is kept.
 */
export function readToUnicode(text: string, bytes: 1 | 2): CodeMap {
  const out: CodeMap = new Map();
  const width = bytes * 2;
  const put = (code: number, letter: string) => {
    if ([...letter].length !== 1 || out.has(letter)) return;
    out.set(letter, code.toString(16).padStart(width, "0").toUpperCase());
  };
  for (const section of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) put(parseInt(m[1], 16), hexText(m[2]));
  }
  for (const section of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = Math.min(parseInt(m[2], 16), lo + 65535);
      if (m[3].startsWith("[")) {
        const list = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]);
        list.forEach((hex, i) => lo + i <= hi && put(lo + i, hexText(hex)));
      } else {
        const start = hexText(m[3].slice(1, -1));
        if (!start) continue;
        // The range counts up from its first letter (the last UTF-16 unit goes up by one each time).
        const head = start.slice(0, -1);
        const last = start.charCodeAt(start.length - 1);
        for (let c = lo; c <= hi; c++) put(c, head + String.fromCharCode(last + (c - lo)));
      }
    }
  }
  return out;
}

/** The letters WinAnsi (the usual Western list) puts at codes 128–159; the rest match their own numbers. */
const WIN_ANSI_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

/** Letter → code for a font using WinAnsi. */
export function winAnsiCodes(): CodeMap {
  const out: CodeMap = new Map();
  const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  for (let c = 0x20; c <= 0x7e; c++) out.set(String.fromCharCode(c), hex(c));
  for (const [code, letter] of Object.entries(WIN_ANSI_HIGH)) out.set(String.fromCharCode(letter), hex(Number(code)));
  for (let c = 0xa0; c <= 0xff; c++) out.set(String.fromCharCode(c), hex(c));
  return out;
}

/** The codes to write `text` with, as hex, or null when the font lacks one of its letters. */
export function encodeWith(codes: CodeMap, text: string): string | null {
  let out = "";
  for (const ch of text) {
    const code = codes.get(ch) ?? (ch === " " ? codes.get(" ") : undefined);
    if (code === undefined) return null;
    out += code;
  }
  return out;
}

/** The letters of `text` a font can't write (each once), "" when it has them all. Spaces are ignored. */
export function missingLetters(codes: CodeMap, text: string): string {
  const bad = new Set<string>();
  for (const ch of text.replace(/[\s]/g, "")) if (!codes.has(ch)) bad.add(ch);
  return [...bad].join(" ");
}

/**
 * Read a two-byte font's widths (its `W` list: `c [w1 w2 …]` or `c1 c2 w`)
 * into code → width (thousandths of the letter size).
 */
export function readCidWidths(list: (number | number[])[]): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < list.length; ) {
    const first = list[i];
    const next = list[i + 1];
    if (typeof first !== "number") {
      i++;
      continue;
    }
    if (Array.isArray(next)) {
      next.forEach((w, k) => out.set(first + k, w));
      i += 2;
    } else if (typeof next === "number" && typeof list[i + 2] === "number") {
      for (let c = first; c <= next && c - first < 65536; c++) out.set(c, list[i + 2] as number);
      i += 3;
    } else i++;
  }
  return out;
}

/** A font's name as people know it: "ABCDEF+Calibri-BoldItalic" → "Calibri bold slanted". */
export function fontLabel(base: string): string {
  const name = base.replace(/^[A-Z]{6}\+/, "");
  const [family, style = ""] = name.split(/[-,]/);
  const words = family.replace(/MT$|PSMT$|PS$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  const bits = [/bold|black|heavy|semibold/i.test(style) || /bold/i.test(family) ? "bold" : "", /italic|oblique/i.test(style) || /italic/i.test(family) ? "slanted" : ""].filter(Boolean);
  return [words.replace(/\s*(Bold|Italic)\b/g, "").trim() || name, ...bits].join(" ");
}
