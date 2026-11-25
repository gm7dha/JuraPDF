/**
 * How quick JuraPDF feels with a big PDF: builds a long PDF (500 pages of
 * words and drawings), drops it on the built app in headless Chromium and
 * times opening, the first page showing, jumping far, zooming, a page change
 * and Undo. Run `npm run build` first, then `node scripts/bench.mjs`.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGES = Number(process.env.BENCH_PAGES || 500);
const dist = "dist";
const base = "/JuraPDF/";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  let path = new URL(req.url, "http://x").pathname;
  if (path.startsWith(base)) path = path.slice(base.length - 1);
  if (path === "/" || path === "") path = "/index.html";
  try {
    const data = await readFile(join(dist, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(4175, "127.0.0.1", r));

async function bigPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < PAGES; p++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Bench page ${p + 1}`, { x: 50, y: 790, size: 24, font });
    for (let l = 0; l < 45; l++) page.drawText(`Line ${l + 1} of page ${p + 1}: the quick brown fox jumps over the lazy dog, again and again.`, { x: 50, y: 750 - l * 15, size: 10, font });
    for (let k = 0; k < 20; k++) page.drawRectangle({ x: 300 + k * 10, y: 60 + k * 5, width: 40, height: 20, color: rgb(k / 20, 0.3, 0.6), opacity: 0.5 });
  }
  return Buffer.from(await doc.save());
}

const pdf = await bigPdf();
console.log(`PDF: ${PAGES} pages, ${(pdf.length / 1e6).toFixed(1)} MB`);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
page.on("pageerror", (e) => console.log("page error", e.message));
await page.goto(`http://127.0.0.1:4175${base}?smoke`);
await page.getByText("Open a PDF to get started").waitFor();

const results = [];
const time = async (name, fn) => {
  const t = Date.now();
  await fn();
  const ms = Date.now() - t;
  results.push([name, ms]);
  console.log(`${name}: ${ms} ms`);
};
const store = (fn, arg) => page.evaluate(fn, arg);

await time("open → first page drawn", async () => {
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "Big.pdf", { type: "application/pdf" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, pdf.toString("base64"));
  await page.waitForFunction(() => document.querySelector('.page[data-page="1"].drawn'), null, { timeout: 120_000 });
});
await time("first thumbnail drawn", () => page.waitForFunction(() => document.querySelector(".thumb-picture canvas"), null, { timeout: 60_000 }));
await time("jump to page 400 → drawn", async () => {
  await store(() => window.jurapdfStore.getState().goToPage(399));
  await page.waitForFunction(() => document.querySelector('.page[data-page="400"].drawn'), null, { timeout: 60_000 });
});
await time("zoom to 200% → sharp", async () => {
  await store(() => window.jurapdfStore.getState().setZoom(2));
  await page.waitForTimeout(50);
  await page.waitForFunction(() => {
    const c = document.querySelector('.page[data-page="400"] canvas');
    const el = document.querySelector('.page[data-page="400"]');
    return c && el && c.width >= el.clientWidth * 0.95;
  }, null, { timeout: 60_000 });
});
await store(() => window.jurapdfStore.getState().setZoom("width"));
await time("turn a page (change) → shown", async () => {
  await page.getByRole("button", { name: "Turn right" }).click();
  await page.waitForFunction(() => window.jurapdfStore.getState().past.length === 1, null, { timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('.page[data-page="400"].drawn'), null, { timeout: 60_000 });
});
await time("undo → shown", async () => {
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.jurapdfStore.getState().past.length === 0, null, { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('.page[data-page="400"].drawn'), null, { timeout: 60_000 });
});
await time("scroll through 50 pages", async () => {
  for (let i = 0; i < 50; i++) {
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(100);
  const cur = await store(() => window.jurapdfStore.getState().currentPage);
  await page.waitForFunction((n) => document.querySelector(`.page[data-page="${n + 1}"].drawn`), cur, { timeout: 60_000 });
});
const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
console.log(`JS memory: ${(heap / 1e6).toFixed(0)} MB`);
await browser.close();
server.close();
