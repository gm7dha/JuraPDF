/**
 * Live with Claude, end to end in Node: the extension's real WebSocket server
 * and bridge (src/mcp/websocket.ts, live.ts), the app's real live client
 * (src/live/client.ts) over Node's own WebSocket, a stand-in for the app's
 * store (a PDF and its undo list), and Claude's tools.
 */
import { request, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { base64ToBytes, bytesToBase64 } from "../src/model/base64";
import { LiveClient, type LiveHost, type SocketLike } from "../src/live/client";
import { LIVE_PATH, LIVE_SUBPROTOCOL } from "../src/live/protocol";
import { PdfFolder } from "../src/mcp/files";
import { LiveBridge } from "../src/mcp/live";
import { Session } from "../src/mcp/session";
import { callTool, type ToolResult } from "../src/mcp/tools";
import { startLiveServer } from "../src/mcp/websocket";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach((f) => f());
});

const textOf = (r: ToolResult) => r.content.map((c) => c.text).join("\n");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean | Promise<boolean>, what: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await wait(10);
  }
}

/** A PDF of `count` A4 pages, each saying "<name> page N". */
async function pdfOf(name: string, count: number): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i++) doc.addPage([595, 842]).drawText(`${name} page ${i}`, { x: 60, y: 760, size: 24, font });
  return (await doc.save()) as Uint8Array<ArrayBuffer>;
}
const pagesIn = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();
const turnOf = async (bytes: Uint8Array, i: number) => (await PDFDocument.load(bytes)).getPage(i).getRotation().angle;

/** The app, as far as the live link sees it: a PDF with undo, and something that may be in the way. */
class FakeApp implements LiveHost {
  appVersion = "test";
  browser = "chrome" as const;
  past: Uint8Array<ArrayBuffer>[] = [];
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  inTheWay: string | null = null;
  applied: { label: string; replace: boolean }[] = [];
  private listeners = new Set<() => void>();
  constructor(name: string, bytes: Uint8Array<ArrayBuffer>) {
    this.name = name;
    this.bytes = bytes;
  }
  current() {
    const bytes = this.bytes;
    return { key: bytes, name: this.name, file: () => bytesToBase64(bytes) };
  }
  busy() {
    return this.inTheWay;
  }
  async apply(name: string, file: string, label: string, replace: boolean) {
    const bytes = base64ToBytes(file);
    if (!bytes) return "not base64";
    // Like the real app, which takes a moment to show it.
    await wait(5);
    this.past.push(this.bytes);
    this.bytes = bytes;
    if (replace) this.name = name;
    this.applied.push({ label, replace });
    // Like the real store, which tells its listeners (the live link among them) straight away.
    this.listeners.forEach((f) => f());
    return null;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** The user changes the PDF (and the app tells the link, unless `quietly`). */
  edit(bytes: Uint8Array<ArrayBuffer>, quietly = false) {
    this.past.push(this.bytes);
    this.bytes = bytes;
    if (!quietly) this.listeners.forEach((f) => f());
  }
  undo() {
    const before = this.past.pop();
    if (before) this.bytes = before;
    this.listeners.forEach((f) => f());
  }
}

const SITE = "https://gm7dha.github.io";
const socketFrom = (origin: string) => (url: string, protocol: string) => new WebSocket(url, { protocols: [protocol], headers: { origin } } as unknown as string[]) as unknown as SocketLike;

async function chat(opts: { allowLocalOrigins?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jurapdf-live-"));
  const bridge = new LiveBridge("test-ext", () => {}, 20_000);
  const started = await startLiveServer({ ports: [0], accept: (c) => bridge.connect(c), allowLocalOrigins: opts.allowLocalOrigins });
  if (!started) throw new Error("no port");
  const session = new Session(new PdfFolder(join(dir, "JuraPDF")));
  session.live = bridge;
  cleanups.push(() => {
    bridge.close();
    (started.server as Server).close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { bridge, port: started.port, session };
}

async function setup(name = "Demo.pdf", pages = 3) {
  const c = await chat();
  const app = new FakeApp(name, await pdfOf(name.replace(".pdf", ""), pages));
  const client = new LiveClient(app, socketFrom(SITE), [c.port]);
  cleanups.push(() => client.disconnect());
  return { ...c, app, client };
}

async function ok(s: Session, name: string, args: unknown = {}) {
  const r = await callTool(s, name, args);
  if (r.isError) throw new Error(`${name} failed: ${textOf(r)}`);
  return textOf(r);
}

/** Try a raw WebSocket handshake; resolves with the HTTP status. */
function handshake(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path: LIVE_PATH,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Protocol": LIVE_SUBPROTOCOL, ...headers },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on("response", (res) => resolve(res.statusCode ?? 0));
    req.on("error", reject);
    req.end();
  });
}

describe("Live with Claude", () => {
  it("only lets the JuraPDF site in", async () => {
    const { port, bridge } = await setup();
    expect(await handshake(port, { Origin: "https://evil.example" })).toBe(403);
    expect(await handshake(port, {})).toBe(403);
    expect(await handshake(port, { Origin: SITE, Host: `evil.example:${port}` })).toBe(403);
    expect(await handshake(port, { Origin: SITE, "Sec-WebSocket-Protocol": "juracad-live.1" })).toBe(400);
    for (const origin of ["http://localhost:9999", "http://127.0.0.1:1234", "https://localhost"]) expect(await handshake(port, { Origin: origin })).toBe(403);
    const stranger = new LiveClient(new FakeApp("x.pdf", await pdfOf("x", 1)), socketFrom("https://evil.example"), [port]);
    expect((await stranger.connect()).kind).toBe("failed");
    expect(bridge.connected).toBe(false);
    expect(await handshake(port, { Origin: SITE })).toBe(101);
    const dev = await chat({ allowLocalOrigins: true });
    expect(await handshake(dev.port, { Origin: "http://localhost:4173" })).toBe(101);
  });

  it("works on the PDF open in the tab, one undo step for each change", async () => {
    const { app, client, bridge, session } = await setup("Open in the tab.pdf", 3);
    expect(await ok(session, "live_status")).toMatch(/Live: not connected/);
    expect((await client.connect()).kind).toBe("connected");
    await until(() => bridge.connected, "the tab");
    expect(await ok(session, "live_status")).toMatch(/Live: connected.*showing Open in the tab\.pdf/);
    expect(await ok(session, "describe_pdf")).toMatch(/Open in the tab\.pdf: 3 pages[\s\S]*Page 2: Open in the tab page 2/);
    const said = await ok(session, "turn_pages", { pages: 2, direction: "right" });
    expect(said).toMatch(/Live: this now shows in the user's open JuraPDF tab/);
    expect(await turnOf(app.bytes, 1)).toBe(90);
    expect(app.applied).toEqual([{ label: "Claude: turned page 2", replace: false }]);
    await ok(session, "add_watermark", { words: "DRAFT" });
    expect(app.past).toHaveLength(2);
    // Looking changes nothing and sends nothing.
    await ok(session, "read_words", { pages: "all" });
    expect(app.applied).toHaveLength(2);
    // The user undoes Claude's last step and deletes a page of their own: Claude sees the PDF as it is now.
    app.undo();
    const doc = await PDFDocument.load(app.bytes);
    doc.removePage(0);
    app.edit((await doc.save()) as Uint8Array<ArrayBuffer>);
    await until(async () => !!bridge.doc && (await pagesIn(bridge.doc.bytes)) === 2, "the user's change to arrive");
    const look = await ok(session, "describe_pdf");
    expect(look).toMatch(/2 pages/);
    expect(look).toMatch(/Page 1: Open in the tab page 2/);
    expect(look).not.toMatch(/DRAFT/);
    // A whole new PDF from Claude replaces the one on show (as one step).
    await ok(session, "new_pdf", { name: "From Claude", pages: 4 });
    expect(app.name).toBe("From Claude.pdf");
    expect(await pagesIn(app.bytes)).toBe(4);
    expect(app.applied[app.applied.length - 1]).toEqual({ label: "Claude: started a new PDF, From Claude.pdf", replace: true });
  });

  it("refuses a change made from an older PDF or while the user is busy, and loses nothing", async () => {
    const { app, client, bridge, session } = await setup("Busy.pdf", 3);
    await client.connect();
    await until(() => bridge.connected, "the tab");
    await ok(session, "add_blank_pages", { after: "end" });
    expect(await pagesIn(app.bytes)).toBe(4);
    // The user changes the PDF at the same moment (the news hasn't reached the extension yet).
    const theirs = await PDFDocument.load(app.bytes);
    theirs.removePage(3);
    theirs.removePage(2);
    app.edit((await theirs.save()) as Uint8Array<ArrayBuffer>, true);
    const r = await callTool(session, "delete_pages", { pages: 1 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/changed the PDF in JuraPDF at the same moment.*NOT applied/);
    expect(await pagesIn(app.bytes)).toBe(2);
    // Claude looks again and retries: now it goes in, on top of the user's change.
    app.edit(app.bytes);
    await until(async () => !!bridge.doc && (await pagesIn(bridge.doc.bytes)) === 2, "the user's change to arrive");
    await ok(session, "delete_pages", { pages: 1 });
    expect(await pagesIn(app.bytes)).toBe(1);
    app.inTheWay = "The user has the Watermark window open in JuraPDF.";
    const busy = await callTool(session, "add_blank_pages", { after: 1 });
    expect(textOf(busy)).toMatch(/didn't take this change: The user has the Watermark window open/);
    expect(await pagesIn(app.bytes)).toBe(1);
    expect(await pagesIn(session.doc!.bytes)).toBe(1);
    app.inTheWay = null;
    await ok(session, "add_blank_pages", { after: 1 });
    expect(await pagesIn(app.bytes)).toBe(2);
  });

  it("goes back to Claude's own copy when the tab disconnects, and takes the next tab's PDF afresh", async () => {
    const { app, client, bridge, session, port } = await setup("First.pdf", 2);
    await client.connect();
    await until(() => bridge.connected, "the tab");
    await ok(session, "add_blank_pages", { after: 0 });
    client.disconnect();
    await until(() => !bridge.connected, "the tab to go");
    await ok(session, "add_blank_pages", { after: 0 });
    expect(await pagesIn(app.bytes)).toBe(3);
    expect(await pagesIn(session.doc!.bytes)).toBe(4);
    const second = new FakeApp("Second.pdf", await pdfOf("Second", 5));
    const secondClient = new LiveClient(second, socketFrom(SITE), [port]);
    cleanups.push(() => secondClient.disconnect());
    await secondClient.connect();
    await until(() => bridge.connected, "the second tab");
    expect(bridge.version).toBe(1);
    expect(await ok(session, "describe_pdf")).toMatch(/Second\.pdf: 5 pages/);
    // Only one tab at a time for a chat: a third is told why.
    const third = new LiveClient(new FakeApp("Third.pdf", await pdfOf("Third", 1)), socketFrom(SITE), [port]);
    cleanups.push(() => third.disconnect());
    expect((await third.connect()).kind).toBe("failed");
  });

  it("links every Claude chat, and passes one chat's change on to the others", async () => {
    const a = await chat();
    const b = await chat();
    const app = new FakeApp("Shared.pdf", await pdfOf("Shared", 2));
    const client = new LiveClient(app, socketFrom(SITE), [a.port, b.port]);
    cleanups.push(() => client.disconnect());
    const state = await client.connect();
    expect(state.kind === "connected" && state.chats).toBe(2);
    await until(() => a.bridge.connected && b.bridge.connected, "both chats");
    await ok(a.session, "turn_pages", { pages: 1, direction: "half" });
    await until(async () => !!b.bridge.doc && (await turnOf(b.bridge.doc.bytes, 0)) === 180, "the other chat to hear of it");
    expect(await ok(b.session, "describe_pdf", { words: false })).toMatch(/turned 180°/);
    await ok(b.session, "delete_pages", { pages: 2 });
    expect(await pagesIn(app.bytes)).toBe(1);
    expect(await turnOf(app.bytes, 0)).toBe(180);
  });
});
