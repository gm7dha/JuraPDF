/**
 * Reading a page's drawing instructions (its "content stream": numbers and
 * names followed by short commands such as `cm` "set the matrix", `Do` "draw
 * this picture", `q`/`Q` "remember/restore the settings"). Just enough to find
 * each command and where it sits in the bytes, so one can be changed in place.
 */

export type Operand = number | string | null;

export interface Op {
  op: string;
  /** Numbers as numbers; names as "/Name"; anything else (text, lists) as null. */
  args: Operand[];
  /** Where the command and its operands start and end in the bytes (end is just after it). */
  start: number;
  end: number;
}

const isSpace = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const isDelim = (c: number) => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;

export function parseContent(bytes: Uint8Array): Op[] {
  const ops: Op[] = [];
  let args: Operand[] = [];
  let argsStart = -1;
  let i = 0;
  const n = bytes.length;
  /** Nesting of [ ] and << >>: inside, everything counts as one operand. */
  let depth = 0;
  const startArg = (at: number) => {
    if (argsStart < 0) argsStart = at;
  };
  const push = (v: Operand) => {
    if (depth === 0) args.push(v);
  };
  while (i < n) {
    const c = bytes[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === 0x25) {
      // A comment, to the end of the line.
      while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }
    const at = i;
    if (c === 0x28) {
      // (text), with nested brackets and \ escapes.
      startArg(at);
      let level = 0;
      for (; i < n; i++) {
        const d = bytes[i];
        if (d === 0x5c) i++;
        else if (d === 0x28) level++;
        else if (d === 0x29 && --level === 0) {
          i++;
          break;
        }
      }
      push(null);
      continue;
    }
    if (c === 0x3c && bytes[i + 1] === 0x3c) {
      startArg(at);
      if (depth === 0) args.push(null);
      depth++;
      i += 2;
      continue;
    }
    if (c === 0x3e && bytes[i + 1] === 0x3e) {
      depth = Math.max(0, depth - 1);
      i += 2;
      continue;
    }
    if (c === 0x3c) {
      // <hex text>
      startArg(at);
      while (i < n && bytes[i] !== 0x3e) i++;
      i++;
      push(null);
      continue;
    }
    if (c === 0x5b) {
      startArg(at);
      if (depth === 0) args.push(null);
      depth++;
      i++;
      continue;
    }
    if (c === 0x5d) {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (c === 0x7b || c === 0x7d) {
      i++;
      continue;
    }
    if (c === 0x2f) {
      // /Name
      startArg(at);
      i++;
      while (i < n && !isSpace(bytes[i]) && !isDelim(bytes[i])) i++;
      push(decodeName(bytes.subarray(at, i)));
      continue;
    }
    // A number or a command word.
    while (i < n && !isSpace(bytes[i]) && !isDelim(bytes[i])) i++;
    if (i === at) {
      // A stray bracket: step over it.
      i++;
      continue;
    }
    const word = String.fromCharCode(...bytes.subarray(at, i));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      startArg(at);
      push(Number(word));
      continue;
    }
    if (depth > 0) continue; // true, false, null inside a list or dictionary
    if (word === "true" || word === "false" || word === "null") {
      startArg(at);
      push(null);
      continue;
    }
    ops.push({ op: word, args, start: argsStart >= 0 ? argsStart : at, end: i });
    args = [];
    argsStart = -1;
    if (word === "ID") {
      // A small picture written right here: skip its bytes up to "EI".
      i++;
      while (i < n && !(isSpace(bytes[i - 1]) && bytes[i] === 0x45 && bytes[i + 1] === 0x49 && (i + 2 >= n || isSpace(bytes[i + 2]) || isDelim(bytes[i + 2])))) i++;
      const end = Math.min(n, i + 2);
      ops.push({ op: "EI", args: [], start: i, end });
      i = end;
    }
  }
  return ops;
}

/** "/A#20B" → "/A B". */
function decodeName(raw: Uint8Array): string {
  return String.fromCharCode(...raw).replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** The bytes with some spans replaced (spans don't overlap; any order). */
export function splice(bytes: Uint8Array, edits: { start: number; end: number; text: string }[]): Uint8Array {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const e of sorted) {
    parts.push(bytes.subarray(at, e.start), new TextEncoder().encode(e.text));
    at = e.end;
  }
  parts.push(bytes.subarray(at));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}
