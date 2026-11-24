/**
 * The PDF Claude is working on in one chat: the PDF itself, its own undo
 * list, the file it was opened from or saved to, and the live link with the
 * user's JuraPDF tab (when there is one). Pure but for the folder.
 */
import type { PdfFolder } from "./files";
import type { ToolResult } from "./toolKit";

/** A PDF: its name (e.g. "Report.pdf") and the file's bytes. */
export interface PdfDoc {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** What the live link with the user's JuraPDF tab says about itself (see live.ts). */
export interface LiveStatus {
  connected: boolean;
  text: string;
}

/**
 * The live link with a JuraPDF tab (src/mcp/live.ts). While it's connected,
 * tools run on the PDF open in that tab and their changes are sent to it.
 */
export interface LiveLink {
  readonly connected: boolean;
  status(): LiveStatus;
  call(s: Session, tool: string, run: () => Promise<ToolResult>, signal?: AbortSignal): Promise<ToolResult>;
}

export interface SessionSnapshot {
  doc: PdfDoc | null;
  past: { doc: PdfDoc; label: string }[];
  file: string | null;
  generation: number;
  label: string;
}

/** Thrown when Claude has cancelled the call (MCP's notifications/cancelled). */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

const MOST_UNDO = 30;

export class Session {
  doc: PdfDoc | null = null;
  /** Earlier versions, newest last, with what changed each (Claude's own undo). */
  past: { doc: PdfDoc; label: string }[] = [];
  /** The file name (in the folder) the PDF was opened from or last saved to. */
  file: string | null = null;
  /** Goes up whenever the whole PDF is replaced (new_pdf, open_pdf). */
  generation = 0;
  /** What the last change did, in a few words ("turned page 2"), for the user's Undo list when live. */
  label = "";
  live: LiveLink | null = null;
  /** The call being run: its cancel signal, and whether it has written a file. */
  signal: AbortSignal | null = null;
  wroteFile = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly folder: PdfFolder | null) {}

  /** Calls run one at a time (Claude may send several at once). */
  serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => {});
    return next;
  }

  get cancelled(): boolean {
    return !!this.signal?.aborted;
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new Cancelled();
  }

  /** Take a changed PDF as the next step, labelled ("turned page 2"). */
  commit(bytes: Uint8Array<ArrayBuffer>, label: string): void {
    if (!this.doc) return;
    this.past = [...this.past.slice(-(MOST_UNDO - 1)), { doc: this.doc, label }];
    this.doc = { ...this.doc, bytes };
    this.label = label;
  }

  /** Go back one of Claude's own steps. The label of the step undone, or null when there is none. */
  undo(): string | null {
    const before = this.past[this.past.length - 1];
    if (!before) return null;
    this.past = this.past.slice(0, -1);
    this.doc = before.doc;
    this.label = `undid "${before.label}"`;
    return before.label;
  }

  /** Start again with another PDF (new_pdf, open_pdf). */
  reset(doc: PdfDoc, file: string | null): void {
    this.doc = doc;
    this.past = [];
    this.file = file;
    this.generation++;
  }

  /** Take the PDF open in the user's JuraPDF tab as the one being worked on (its undo list is the tab's). */
  adopt(doc: PdfDoc): void {
    this.doc = doc;
    this.past = [];
  }

  snapshot(): SessionSnapshot {
    return { doc: this.doc, past: this.past, file: this.file, generation: this.generation, label: this.label };
  }

  restore(snap: SessionSnapshot): void {
    this.doc = snap.doc;
    this.past = snap.past;
    this.file = snap.file;
    this.generation = snap.generation;
    this.label = snap.label;
  }
}
