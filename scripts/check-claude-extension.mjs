/**
 * Checks the Claude extension the way Claude's desktop app would use it:
 *   node scripts/check-claude-extension.mjs dist/jurapdf-claude.mcpb
 * Unpacks the .mcpb (a zip), checks its manifest, starts its server with Node
 * and talks MCP to it over stdin/stdout: lists the tools, starts a PDF, reads
 * one from the folder, watermarks, turns, moves, deletes and adds pages, joins
 * and splits PDFs, saves — then checks those files with pdf-lib — and cancels
 * a call (nothing may change). Then it connects to the live link
 * (Live with Claude) as the JuraPDF tab would, works over it, and checks the
 * extension stops when Claude closes it.
 * Fails (exit code 1, with GitHub annotations in CI) if anything is wrong.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";

const inCI = process.env.GITHUB_ACTIONS === "true";
const fail = (msg) => {
  if (inCI) console.log(`::error title=Claude extension check failed::${String(msg).replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`);
  console.error(`FAILED: ${msg}`);
  process.exit(1);
};
const check = (cond, msg) => cond || fail(msg);

/** Unpack a zip file (stored or deflated entries) into a folder. */
function unzip(file, into) {
  const zip = readFileSync(file);
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  check(end >= 0, `${file} isn't a zip file.`);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    check(zip.readUInt32LE(at) === 0x02014b50, "The zip's directory is damaged.");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    check(!name.includes("..") && !name.startsWith("/"), `Unsafe path in the zip: ${name}`);
    names.push(name);
    if (name.endsWith("/")) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : fail(`Unsupported zip method ${method} for ${name}`);
    mkdirSync(dirname(join(into, name)), { recursive: true });
    writeFileSync(join(into, name), data);
  }
  return names;
}

const target = process.argv[2] ?? "dist/jurapdf-claude.mcpb";
check(existsSync(target), `${target} doesn't exist — the extension wasn't built.`);
const work = mkdtempSync(join(tmpdir(), "jurapdf-ext-"));
let dir = target;
if (statSync(target).isFile()) {
  dir = join(work, "unpacked");
  const names = unzip(target, dir);
  console.log(`${target}: ${(statSync(target).size / 1e6).toFixed(1)} MB, ${names.length} entries`);
  check(!names.some((n) => n.startsWith("node_modules/")), "The bundle shouldn't need node_modules.");
}

// The manifest.
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
check(typeof manifest.manifest_version === "string", "manifest_version is missing.");
check(manifest.name === "jurapdf", "The manifest's name should be jurapdf.");
check(manifest.version === pkg.version, `The manifest's version (${manifest.version}) should be the app's (${pkg.version}).`);
check(manifest.author?.name && manifest.description, "The manifest needs an author and a description.");
check(manifest.server?.type === "node" && existsSync(join(dir, manifest.server.entry_point)), "The server's entry point is missing.");
check(existsSync(join(dir, manifest.icon)), "The icon is missing.");
for (const f of ["LICENSE", "THIRD-PARTY-NOTICES.txt"]) check(existsSync(join(dir, f)), `${f} is missing.`);
check(!manifest.compatibility?.platforms?.includes("linux"), "Claude's desktop app runs on macOS and Windows only.");
check(manifest.user_config?.pdf_folder?.type === "directory", "The PDF folder setting should be a directory.");
check(manifest.server.mcp_config.args.includes("${user_config.pdf_folder}"), "The server should be given the PDF folder.");
check(Array.isArray(manifest.tools) && manifest.tools.length >= 10, "The manifest should list the tools.");

// Start the server and talk to it.
const pdfs = join(work, "My PDFs");
const child = spawn(process.execPath, [join(dir, manifest.server.entry_point), pdfs], { stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));
const waiting = new Map();
let buffer = "";
child.stdout.on("data", (d) => {
  buffer += d;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(`The server printed something that isn't MCP on stdout: ${line.slice(0, 200)}`);
    }
    if (msg.id !== undefined && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  }
});
child.on("exit", (code) => waiting.size && fail(`The server stopped (code ${code}).\n${stderr.slice(-2000)}`));
let nextId = 1;
const send = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
const timer = setTimeout(() => fail(`Timed out talking to the server.\n${stderr.slice(-2000)}`), 120_000);

const init = await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "jurapdf-check", version: "1" } });
check(init.result?.serverInfo?.name === "jurapdf", `initialize failed: ${JSON.stringify(init).slice(0, 500)}`);
check(/Pages are numbered from 1/.test(init.result?.instructions ?? ""), "The server's instructions should explain how pages are described.");
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const listed = await send("tools/list", {});
const tools = listed.result?.tools ?? [];
check(tools.length === manifest.tools.length, `The server has ${tools.length} tools; the manifest lists ${manifest.tools.length}.`);
for (const t of manifest.tools) check(tools.some((x) => x.name === t.name), `The manifest's tool ${t.name} isn't on the server.`);

const call = async (name, args) => {
  const r = await send("tools/call", { name, arguments: args });
  check(!r.error && !r.result?.isError, `${name} failed: ${JSON.stringify(r.error ?? r.result).slice(0, 800)}`);
  return r.result.content;
};
const text = (content) => content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

/** A PDF whose pages say "<name> page N". */
async function wordsPdf(name, count) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i++) doc.addPage([595, 842]).drawText(`${name} page ${i}`, { x: 60, y: 760, size: 24, font });
  return Buffer.from(await doc.save());
}
mkdirSync(pdfs, { recursive: true });
writeFileSync(join(pdfs, "Report.pdf"), await wordsPdf("Report", 3));
writeFileSync(join(pdfs, "Extra.pdf"), await wordsPdf("Extra", 2));

// Read a PDF from the folder: its pages and their words (pdf.js, inside the bundle).
const listedPdfs = text(await call("list_pdfs", {}));
check(/Report\.pdf/.test(listedPdfs) && /Extra\.pdf/.test(listedPdfs), `list_pdfs doesn't list the PDFs:\n${listedPdfs}`);
const opened = text(await call("open_pdf", { filename: "Report" }));
check(/Report\.pdf: 3 pages/.test(opened) && /Page 2: Report page 2/.test(opened), `open_pdf doesn't describe the PDF and its words:\n${opened}`);
const words = text(await call("read_words", { pages: "3" }));
check(/--- Page 3 ---\nReport page 3/.test(words), `read_words doesn't read page 3:\n${words}`);
// Change it: a watermark, a turn, a move, a blank page, another PDF's pages, a delete.
await call("add_watermark", { words: "CI DRAFT", colour: "blue", pages: "1-2" });
await call("add_words", { page: 1, words: "Checked by CI", x: 72, y: 72 });
await call("turn_pages", { pages: [2], direction: "right" });
await call("move_pages", { pages: 3, before: 1 });
await call("add_blank_pages", { after: "end" });
await call("bring_in_pdf", { filename: "Extra.pdf", after: 1 });
await call("delete_pages", { pages: "last" });
const described = text(await call("describe_pdf", {}));
check(/Report\.pdf: 5 pages/.test(described) && /Page 1: Report page 3/.test(described) && /Page 2: Extra page 1/.test(described) && /turned 90°/.test(described), `The changes aren't as expected:\n${described}`);
await call("undo", {});
check(/6 pages/.test(text(await call("describe_pdf", { words: false }))), "undo should bring the deleted page back.");
// Nothing outside the chosen folder.
const escape = await send("tools/call", { name: "save_pdf", arguments: { filename: "../outside" } });
check(escape.result?.isError && /plain file name/.test(text(escape.result.content)), "Saving outside the folder should be refused.");
await call("save_pdf", { filename: "Report changed" });
const saved = await PDFDocument.load(readFileSync(join(pdfs, "Report changed.pdf")));
check(saved.getPageCount() === 6 && saved.getPage(4).getRotation().angle === 90, "The saved PDF should have 6 pages, page 5 (the old page 2) turned.");
await call("save_pages_as_pdf", { pages: "1-2", filename: "First two" });
check((await PDFDocument.load(readFileSync(join(pdfs, "First two.pdf")))).getPageCount() === 2, "save_pages_as_pdf should save 2 pages.");
await call("new_pdf", { name: "Blank", pages: 2, size: "Letter", landscape: true });
check(/Blank\.pdf: 2 pages/.test(text(await call("describe_pdf", { words: false }))) , "new_pdf should start a 2-page PDF.");

// Cancelling a call (as Claude does when the user stops it): no reply, and nothing changed.
const cancelId = nextId++;
let cancelledReply = null;
waiting.set(cancelId, (msg) => (cancelledReply = msg));
child.stdin.write(
  JSON.stringify({ jsonrpc: "2.0", id: cancelId, method: "tools/call", params: { name: "add_blank_pages", arguments: { after: 0, count: 5 } } }) +
    "\n" +
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: cancelId, reason: "The user stopped it." } }) +
    "\n",
);
const afterCancel = text(await call("describe_pdf", { words: false }));
await new Promise((resolve) => setTimeout(resolve, 1000));
check(cancelledReply === null, `A cancelled call was still answered: ${JSON.stringify(cancelledReply).slice(0, 300)}`);
waiting.delete(cancelId);
check(/Blank\.pdf: 2 pages/.test(afterCancel), `A cancelled call still changed the PDF:\n${afterCancel}`);

// Live with Claude: the extension listens on 127.0.0.1 for the JuraPDF tab. Talk to it the way the app does
// (src/live/protocol.ts), from the JuraPDF site's origin, using Node's own WebSocket.
const LIVE_PORTS = Array.from({ length: 10 }, (_, i) => 47655 + i);
const openSocket = (port, origin) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/jurapdf-live`, { protocols: ["jurapdf-live.1"], headers: { origin } });
    ws.onopen = () => resolve(ws);
    ws.onerror = () => resolve(null);
  });
check(!(await openSocket(LIVE_PORTS[0], "https://evil.example")), "A page from another website could open the live link.");
// Pages served on this computer (a dev server, another program) are kept out too, unless JURAPDF_LIVE_DEV=1.
for (const origin of ["http://localhost:5173", "http://127.0.0.1:1234", "https://localhost"]) {
  check(!(await openSocket(LIVE_PORTS[0], origin)), `A page from ${origin} could open the live link.`);
}
let ws = null;
let livePort = 0;
for (const port of LIVE_PORTS) if ((ws = await openSocket(port, "https://gm7dha.github.io"))) {
  livePort = port;
  break;
}
check(ws, `The live link isn't listening on 127.0.0.1 (ports ${LIVE_PORTS.join(", ")}).\n${stderr.slice(-2000)}`);
const fromExtension = [];
let answer = null;
const nextMessage = () => new Promise((resolve) => (answer = resolve));
ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data));
  fromExtension.push(msg);
  if (msg.type === "change") ws.send(JSON.stringify({ type: "applied", id: msg.id, version: msg.base + 1 }));
  answer?.(msg);
};
const live1 = await wordsPdf("Live", 2);
const welcome = nextMessage();
ws.send(JSON.stringify({ type: "hello", protocol: 1, app: pkg.version, version: 1, name: "Live.pdf", file: live1.toString("base64") }));
check((await welcome).type === "welcome", `The live link didn't welcome JuraPDF: ${JSON.stringify(fromExtension)}`);
check(/Live: connected/.test(text(await call("live_status", {}))), "live_status doesn't say it's connected.");
const live = text(await call("turn_pages", { pages: 1, direction: "left" }));
check(/Live: this now shows in the user's open JuraPDF tab/.test(live), `A live change didn't say it was shown:\n${live}`);
let changes = fromExtension.filter((m) => m.type === "change");
check(changes.length === 1 && changes[0].base === 1 && changes[0].label === "Claude: turned page 1" && changes[0].name === "Live.pdf", `Expected one change based on version 1: ${JSON.stringify(changes.map((c) => ({ ...c, file: c.file.length })))}`);
const liveDoc = await PDFDocument.load(Buffer.from(changes[0].file, "base64"));
check(liveDoc.getPageCount() === 2 && liveDoc.getPage(0).getRotation().angle === 270, "The live change isn't the open PDF with page 1 turned left.");
// The user changes the PDF in the app (version 3, now 3 pages): Claude's next change is made on top of it.
ws.send(JSON.stringify({ type: "doc", version: 3, name: "Live.pdf", file: (await wordsPdf("Live", 3)).toString("base64") }));
await call("delete_pages", { pages: 2 });
changes = fromExtension.filter((m) => m.type === "change");
const second = changes[1] && (await PDFDocument.load(Buffer.from(changes[1].file, "base64")));
check(changes.length === 2 && changes[1].base === 3 && second?.getPageCount() === 2, "Claude's second live change wasn't made on the user's latest PDF.");
ws.close();

// Safari's link window: served over plain http on 127.0.0.1 (only under that name), and its origin may open the live link.
const relayPage = await fetch(`http://127.0.0.1:${livePort}/jurapdf-relay`);
const relayHtml = await relayPage.text();
check(relayPage.status === 200 && relayHtml.includes('<script src="/jurapdf-relay.js"></script>'), `The link window page isn't served: ${relayPage.status} ${relayHtml.slice(0, 200)}`);
check(/frame-ancestors 'none'/.test(relayPage.headers.get("content-security-policy") ?? "") && relayPage.headers.get("x-frame-options") === "DENY", "The link window page may be framed.");
const relayJs = await fetch(`http://127.0.0.1:${livePort}/jurapdf-relay.js`);
const relaySource = await relayJs.text();
check(relayJs.status === 200 && /javascript/.test(relayJs.headers.get("content-type") ?? ""), `The link window script isn't served: ${relayJs.status}`);
// Other sites can't load them to find out whether the extension is running.
for (const r of [relayPage, relayJs]) check(r.headers.get("cross-origin-resource-policy") === "same-origin", `The link window's ${r.url} may be loaded by other sites.`);
try {
  new Function(relaySource);
} catch (e) {
  check(false, `The link window script doesn't parse: ${e}`);
}
check(relaySource.includes('"site":"https://gm7dha.github.io"') && relaySource.includes('"allowLocal":false'), "The shipped link window script must obey only the JuraPDF site.");
const relaySocket = await openSocket(livePort, `http://127.0.0.1:${livePort}`);
check(relaySocket, "The link window's origin couldn't open the live link.");
relaySocket?.close();
check(!(await openSocket(livePort, `http://localhost:${livePort}`)), "A page on http://localhost could open the live link.");

clearTimeout(timer);
// When Claude closes the extension (its input), it must stop, freeing the live link's port.
const stopped = new Promise((resolve) => child.once("exit", () => resolve(true)));
child.stdin.end();
const exited = await Promise.race([stopped, new Promise((resolve) => setTimeout(() => resolve(false), 5000))]);
if (!exited) child.kill();
check(exited, "The extension kept running after Claude closed it (it would keep the live link's port busy).");
rmSync(work, { recursive: true, force: true });
console.log(`The Claude extension works: ${tools.length} tools; read a PDF, watermarked, turned, moved, added, brought in and deleted pages, saved it and two pages as a new PDF; a cancelled call changed nothing; wrote live over the local link (${changes.length} changes, each applied once); served Safari's link window.`);
