/**
 * What every JuraPDF tool is made of: the shape of a tool and its result,
 * plain-text replies, and writing files into the chosen folder.
 */
import type { Obj } from "./args";
import { InputError } from "./args";
import type { PdfFolder } from "./files";
import type { Session } from "./session";

export type Content = { type: "text"; text: string };
export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  /** Only looks; changes nothing. */
  readOnly?: boolean;
  /** Can replace a file, or drop the PDF being worked on. */
  destructive?: boolean;
  run: (s: Session, a: Obj) => ToolResult | Promise<ToolResult>;
}

/** A reply of plain lines (false/null/undefined lines are left out). */
export const say = (...lines: (string | false | null | undefined)[]): ToolResult => ({ content: [{ type: "text", text: lines.filter((l) => l !== false && l !== null && l !== undefined).join("\n") }] });

/** A file name made from a name, safe on every computer. */
export function fileNameFor(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 120);
  if (!cleaned || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(cleaned)) return "Document";
  return cleaned;
}

export function needFolder(s: Session): PdfFolder {
  if (!s.folder) throw new InputError("No folder for PDFs is set up. In Claude, open Settings › Extensions › JuraPDF and choose a folder.");
  return s.folder;
}

/**
 * Write a file into the folder — the last thing a tool does. A call cancelled
 * before this writes nothing; once written, the file stays.
 */
export function writeOut(s: Session, path: string, data: string | Uint8Array): void {
  s.throwIfCancelled();
  needFolder(s).write(path, data);
  s.wroteFile = true;
}

/** Refuse to replace an existing file unless asked to. */
export function checkFree(s: Session, path: string, overwrite: unknown): void {
  if (needFolder(s).exists(path) && overwrite !== true) throw new InputError(`There's already a file called "${path.split(/[\\/]/).pop()}". Choose another filename, or pass "overwrite": true.`);
}
