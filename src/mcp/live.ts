/**
 * "Live with Claude", the extension's side: keeps the PDF open in the user's
 * JuraPDF tab (sent by the tab over the local link, see src/live/protocol.ts),
 * runs Claude's tools on it, and sends each change back for the tab to apply
 * as one undo step.
 *
 * Nothing here touches files: the tab only ever sends a PDF (checked to be
 * one) and replies; files are still only written by the saving tools, inside
 * the chosen folder.
 */
import { base64ToBytes, bytesToBase64 } from "../model/base64";
import { looksLikePdf } from "../model/pdfFile";
import { isNewer, parseAppMessage, type AppMessage, type ExtensionMessage } from "../live/protocol";
import type { LiveLink, LiveStatus, PdfDoc, Session } from "./session";
import type { ToolResult } from "./toolKit";

/** What the bridge needs from a connection (a WebSocketConnection, or a stand-in in tests). */
export interface LiveConnection {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onMessage: (text: string) => void;
  onClose: (code: number, reason: string) => void;
}

type Reply = Extract<AppMessage, { type: "applied" | "refused" }> | { type: "timeout" } | { type: "disconnected" };

interface Pending {
  full: PdfDoc;
  base: number;
  resolve: ((r: Reply) => void) | null;
}

/** How long to wait for the tab to apply a change. */
const REPLY_TIMEOUT_MS = 30_000;
/** How long a late reply to a change is still listened for, after giving up waiting. */
const LATE_REPLY_MS = 5 * 60_000;
/** A tab must say hello this soon after connecting, or it's let go (so it can't hold the one place). */
const HELLO_TIMEOUT_MS = 10_000;

/** A short description of what a tool changed, for the undo step in the app ("Claude: turned page 2"). Pure. */
export function describeChange(tool: string, label: string, after: PdfDoc, replaced: boolean): string {
  const say = (t: string) => `Claude: ${t.length > 110 ? `${t.slice(0, 107)}…` : t}`;
  if (replaced) return say(tool === "open_pdf" ? `opened ${after.name}` : `started a new PDF, ${after.name}`);
  return say(label || "changed the PDF");
}

/** The tab's PDF from a message, or null if it isn't one. */
function readPdf(name: string, file: string): PdfDoc | null {
  const bytes = base64ToBytes(file);
  if (!bytes || !looksLikePdf(bytes)) return null;
  return { name: name.trim() || "Document.pdf", bytes };
}

export class LiveBridge implements LiveLink {
  private conn: LiveConnection | null = null;
  /** Has the connected tab said hello (so it's the one in use)? */
  private ready = false;
  private app = "";
  /** The PDF open in the tab, and its version. */
  doc: PdfDoc | null = null;
  version = 0;
  /** Counts the tabs that have connected (said hello): versions start again at 1 with each. */
  private link = 0;
  /** Which tab and version the session last took the PDF from ("link:version"), or null. */
  private adopted: string | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  /** The port listened on, or why the link couldn't start. */
  port: number | null = null;
  startProblem: string | null = null;

  constructor(
    readonly extensionVersion: string,
    private readonly log: (msg: string) => void = () => {},
    private readonly replyTimeout = REPLY_TIMEOUT_MS,
    private readonly helloTimeout = HELLO_TIMEOUT_MS,
  ) {}

  /** The open PDF as the session should have it now. */
  private get current(): string {
    return `${this.link}:${this.version}`;
  }

  get connected(): boolean {
    return !!this.conn && this.ready;
  }

  private send(conn: LiveConnection, msg: ExtensionMessage): void {
    conn.send(JSON.stringify(msg));
  }

  /** A JuraPDF tab has opened the link. Only one tab at a time: a second is turned away, with the reason. */
  connect(conn: LiveConnection): void {
    if (this.conn && !this.ready) {
      // The tab holding the place never said hello: let the new one have it.
      this.log("Live link: a connection that never said hello was replaced by a new one.");
      const old = this.conn;
      this.disconnected(old);
      old.close(1008, "no hello");
    }
    if (this.conn) {
      this.send(conn, {
        type: "busy",
        message: "Another JuraPDF tab is already connected to Claude. Disconnect that one first (or close it), then click Connect to Claude here.",
      });
      conn.close(1008, "another tab is connected");
      return;
    }
    this.conn = conn;
    this.ready = false;
    conn.onMessage = (text) => this.receive(conn, text);
    conn.onClose = () => this.disconnected(conn);
    const timer = setTimeout(() => {
      if (conn === this.conn && !this.ready) this.refuse(conn, "JuraPDF didn't say hello in time. Click Connect to Claude again.");
    }, this.helloTimeout);
    (timer as { unref?: () => void }).unref?.();
  }

  private refuse(conn: LiveConnection, message: string): void {
    this.log(`Live link: ${message}`);
    this.send(conn, { type: "error", message });
    conn.close(1008, "bad message");
  }

  private receive(conn: LiveConnection, text: string): void {
    if (conn !== this.conn) return;
    const msg = parseAppMessage(text);
    if ("error" in msg) return this.refuse(conn, `JuraPDF sent ${msg.error}. Reload the JuraPDF page and connect again.`);
    if (!this.ready && msg.type !== "hello") return this.refuse(conn, "JuraPDF didn't say hello first. Reload the JuraPDF page and connect again.");
    switch (msg.type) {
      case "hello": {
        if (this.ready) return this.refuse(conn, "JuraPDF said hello twice.");
        const doc = readPdf(msg.name, msg.file);
        if (!doc) return this.refuse(conn, "The PDF open in JuraPDF couldn't be read by the extension. Reload the page, or update the extension (Help › Use JuraPDF with Claude).");
        this.ready = true;
        this.link++;
        this.adopted = null;
        this.app = msg.app;
        this.setDesign(doc, msg.version);
        this.send(conn, { type: "welcome", protocol: 1, extension: this.extensionVersion });
        this.log(`Live link: connected to JuraPDF ${msg.app} (${doc.name}).`);
        return;
      }
      case "doc": {
        if (!isNewer(this.version, msg.version)) return;
        const doc = readPdf(msg.name, msg.file);
        if (!doc) return this.refuse(conn, "A change from JuraPDF couldn't be read. Reload the JuraPDF page and connect again.");
        this.setDesign(doc, msg.version);
        return;
      }
      case "applied":
      case "refused": {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.type === "applied") {
          if (msg.version !== p.base + 1 || !isNewer(this.version, msg.version)) {
            // Shouldn't happen; if it does, start again cleanly rather than guess (the tool says so).
            p.resolve?.({ type: "disconnected" });
            return this.refuse(conn, "JuraPDF and the extension lost track of the PDF's versions. Click Connect to Claude again.");
          }
          this.doc = p.full;
          this.version = msg.version;
        }
        // (No one waiting: a late reply after giving up; the session takes the PDF afresh next time.)
        p.resolve?.(msg);
        return;
      }
    }
  }

  private setDesign(doc: PdfDoc, version: number): void {
    this.doc = doc;
    this.version = version;
  }

  private disconnected(conn: LiveConnection): void {
    if (conn !== this.conn) return;
    this.conn = null;
    this.ready = false;
    // Whichever tab connects next, the session takes its PDF afresh.
    this.adopted = null;
    for (const p of this.pending.values()) p.resolve?.({ type: "disconnected" });
    this.pending.clear();
    this.log("Live link: JuraPDF disconnected.");
  }

  /** Close the link (the extension is stopping). */
  close(): void {
    this.conn?.close(1001, "Claude's JuraPDF extension stopped");
  }

  status(): LiveStatus {
    if (this.connected && this.doc) {
      return {
        connected: true,
        text: `Live: connected to the user's open JuraPDF tab (JuraPDF ${this.app}), showing ${this.doc.name}. Every tool works on that PDF, and each change you make appears there straight away as one step in its Undo list. The user can keep working and undoing there too; if they change something at the same moment, your change is refused (nothing lost) and you just look again and retry. The user saves the PDF with Save in JuraPDF; save_pdf saves a copy in the JuraPDF folder.`,
      };
    }
    const where = this.port ? `on this computer (port ${this.port})` : null;
    return {
      connected: false,
      text: this.startProblem
        ? `Live: not available — ${this.startProblem} The tools work on Claude's own copy of a PDF from the JuraPDF folder; save_pdf saves it there for the user to open in JuraPDF.`
        : `Live: not connected. The tools work on Claude's own copy of a PDF from the JuraPDF folder (open_pdf; save_pdf saves it back). To work live on the PDF the user has open in JuraPDF instead, ask them to open https://gm7dha.github.io/JuraPDF/ (Chrome, Edge, Firefox or Safari), open their PDF and click "Connect to Claude" in the top bar (the extension is ready ${where ?? "for it"}). If the user says JuraPDF already shows a green "Live with Claude" badge, this chat started after the tab connected: the tab links new chats by itself within a few seconds, so wait a moment and call live_status again; if it still isn't connected, ask them to click the badge, Disconnect, then Connect to Claude again. In Safari, Connect to Claude opens a small "JuraPDF ↔ Claude" window that must stay open (Safari may ask to allow the pop-up); if the user closed it, ask them to click Connect to Claude again. If live doesn't work for them, put the PDF in the JuraPDF folder and use open_pdf.`,
    };
  }

  /** Run one tool: on the open JuraPDF PDF when connected, one at a time, sending any change back. */
  call(s: Session, tool: string, run: () => Promise<ToolResult>, signal?: AbortSignal): Promise<ToolResult> {
    const next = this.queue.then(() => this.callNow(s, tool, run, signal));
    this.queue = next.catch(() => {});
    return next;
  }

  private async callNow(s: Session, tool: string, run: () => Promise<ToolResult>, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.connected || !this.doc) return run();
    if (this.adopted !== this.current) {
      s.adopt(this.doc);
      this.adopted = this.current;
    }
    // The version this change is made from (more may arrive from the tab while the tool runs).
    const base = this.version;
    const snap = s.snapshot();
    const result = await run();
    const replaced = s.generation !== snap.generation;
    if (result.isError || (s.doc === snap.doc && !replaced) || !s.doc) return result;
    // Cancelled by Claude before the change went to the tab: it's simply not made.
    if (signal?.aborted) {
      s.restore(snap);
      return this.notApplied(
        s.wroteFile
          ? "Cancelled: the call was stopped before its change was sent to JuraPDF, so the PDF wasn't changed — but the file it had already saved in the JuraPDF folder stays."
          : "Cancelled: the call was stopped before its change was sent to JuraPDF, so nothing was changed.",
      );
    }
    const conn = this.conn;
    if (!conn || !this.ready || !this.doc) {
      s.restore(snap);
      return this.notApplied("The JuraPDF tab disconnected before this change could be sent, so it wasn't made. Nothing was changed. Ask the user to click Connect to Claude again (or work on your own copy from the JuraPDF folder and save_pdf).");
    }
    const id = this.nextId++;
    let full: PdfDoc;
    let label: string;
    let reply: Reply;
    try {
      full = s.doc;
      label = describeChange(tool, s.label, s.doc, replaced);
      const message = { type: "change", id, base, name: full.name, file: bytesToBase64(full.bytes), label, replace: replaced } as const;
      reply = await new Promise<Reply>((resolve) => {
        const p: Pending = { full, base, resolve };
        this.pending.set(id, p);
        const timer = setTimeout(() => {
          // Keep listening for a while: if it's applied later, the bridge still learns the new version.
          p.resolve = null;
          resolve({ type: "timeout" });
          const forget = setTimeout(() => this.pending.get(id) === p && this.pending.delete(id), LATE_REPLY_MS);
          (forget as { unref?: () => void }).unref?.();
        }, this.replyTimeout);
        timer.unref?.();
        p.resolve = (r) => {
          clearTimeout(timer);
          p.resolve = null;
          resolve(r);
        };
        // Once sent, a cancellation from Claude can't take the change back: the tab's reply still decides it, so the session stays in step.
        this.send(conn, message);
      });
    } catch (e) {
      this.pending.delete(id);
      s.restore(snap);
      this.adopted = null;
      return this.notApplied(`This change couldn't be sent to JuraPDF (${e instanceof Error ? e.message : String(e)}). Nothing was changed.`);
    }
    if (reply.type === "applied") {
      this.adopted = this.current;
      return { ...result, content: [...result.content, { type: "text", text: `Live: this now shows in the user's open JuraPDF tab, as one step in its undo list ("${label}").` }] };
    }
    s.restore(snap);
    // Take the tab's PDF afresh next time.
    this.adopted = null;
    if (reply.type === "refused") {
      return this.notApplied(
        reply.reason === "changed"
          ? "The user changed the PDF in JuraPDF at the same moment, so this change was NOT applied (nothing was lost or changed). Look at the PDF again (describe_pdf) and make the change again."
          : reply.reason === "busy"
            ? `JuraPDF didn't take this change: ${reply.message} Nothing was changed. Ask the user to finish what they're doing, then try again.`
            : `JuraPDF couldn't use this change (${reply.message}). Nothing was changed.`,
      );
    }
    if (reply.type === "disconnected") {
      return this.notApplied("The JuraPDF tab disconnected before it confirmed this change, so it may not have arrived. Nothing was changed here. Ask the user to click Connect to Claude again, then check with describe_pdf.");
    }
    return this.notApplied("The JuraPDF tab didn't confirm this change in time so it may still appear there. Don't repeat it yet: run describe_pdf (it shows the PDF as the tab has it) and only redo the change if it's missing.");
  }

  private notApplied(why: string): ToolResult {
    return { content: [{ type: "text", text: why }], isError: true };
  }
}
