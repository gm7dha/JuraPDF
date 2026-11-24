/**
 * Browser smoke test: serves the production build, opens it in headless
 * Chromium and does what a person would: drop a PDF on the window → see its
 * pages and thumbnails drawn → select its words → go to a page → zoom in and
 * out → save it → watermark, print → pick, turn, move, delete and add pages.
 * Fails on any console error. Run after `npm run build`.
 *
 * In GitHub Actions, problems are reported as annotations. SMOKE_SCREENSHOT=1
 * also saves smoke.png. CHROMIUM_PATH uses a Chromium already on the computer.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

const inCI = process.env.GITHUB_ACTIONS === "true";
const annotate = (level, title, message) => {
  if (inCI) console.log(`::${level} title=${title}::${String(message).replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`);
  else console.log(`[${level}] ${title}: ${message}`);
};

// The site's base path, as vite.config.ts builds it (CI passes BASE_PATH; default /JuraPDF/).
const wanted = process.env.BASE_PATH || "/JuraPDF/";
const basePath = `/${wanted.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
const dist = process.env.SMOKE_DIST || "dist";
if (!existsSync(join(dist, "index.html"))) {
  annotate("error", "Smoke test", `No build at ${dist}/index.html. Run npm run build first.`);
  process.exit(1);
}

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};
const server = createServer(async (req, res) => {
  let path = new URL(req.url, "http://x").pathname;
  if (path.startsWith(basePath)) path = path.slice(basePath.length - 1);
  if (path === "/" || path === "") path = "/index.html";
  try {
    const data = await readFile(join(dist, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(4174, "127.0.0.1", r));

/**
 * A small PDF made here: three pages (A4, A4, then A4 landscape), each with
 * a big black box and the words "Smoke page N" in Helvetica.
 */
function testPdf() {
  const sizes = [
    [595, 842],
    [595, 842],
    [842, 595],
  ];
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = objects.length + 1 + sizes.length * 2;
  const kids = [];
  for (const [i, [w, h]] of sizes.entries()) {
    const stream = `0 0 0 rg 60 ${h - 300} 200 160 re f\nBT /F1 28 Tf 60 ${h - 100} Td (Smoke page ${i + 1}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
// Save by downloading (the real Save window can't be clicked in a headless browser).
await context.addInitScript(() => {
  delete window.showSaveFilePicker;
  delete window.showOpenFilePicker;
});
const page = await context.newPage();
const problems = [];
// Connect to Claude looks for the extension on each of its ports: the ones with nothing there say so in the console.
const liveProbeRefused = (e) => /^WebSocket connection to 'ws:\/\/127\.0\.0\.1:476(5[5-9]|6[0-4])\/jurapdf-live' failed: .*net::ERR_CONNECTION_REFUSED/.test(e);
page.on("console", (msg) => {
  if (msg.type() === "error" && !liveProbeRefused(msg.text())) problems.push(`Console error: ${msg.text()}`);
});
page.on("pageerror", (err) => problems.push(`Page error: ${err.message}`));

let failed = false;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed = true;
    annotate("error", `Smoke test: ${name}`, e instanceof Error ? e.message : String(e));
  }
};
const expect = (ok, message) => {
  if (!ok) throw new Error(message);
};

const pdf = testPdf();

await step("the app opens", async () => {
  await page.goto(`http://127.0.0.1:4174${basePath}?smoke`);
  await page.getByText("Open a PDF to get started").waitFor({ timeout: 15_000 });
});

await step("a PDF dropped on the window opens", async () => {
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "Smoke test.pdf", { type: "application/pdf" }));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, pdf.toString("base64"));
  await page.locator(".page").nth(2).waitFor({ timeout: 15_000 });
  expect((await page.locator(".page").count()) === 3, "expected 3 pages");
  expect((await page.locator(".thumb").count()) === 3, "expected 3 thumbnails");
  await page.getByText("of 3").waitFor();
  await page.locator(".doc-title", { hasText: "Smoke test" }).waitFor();
});

await step("pages and thumbnails are drawn", async () => {
  await page.waitForFunction(() => document.querySelectorAll(".page.drawn canvas").length >= 2 && document.querySelectorAll(".thumb-picture canvas").length === 3, null, {
    timeout: 15_000,
  });
  // The first page has a big black box on it: some dark pixels, not just white.
  const dark = await page.evaluate(() => {
    const c = document.querySelector('.page[data-page="1"] canvas');
    const ctx = c.getContext("2d");
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) n++;
    return n / (c.width * c.height);
  });
  expect(dark > 0.02, `page 1 looks blank (${(dark * 100).toFixed(2)}% dark)`);
  // Page 3 is landscape: wider than tall.
  const box = await page.locator('.page[data-page="3"]').boundingBox();
  expect(box && box.width > box.height, "page 3 should be landscape");
});

await step("the words can be selected", async () => {
  await page.locator('.page[data-page="1"] .textLayer span', { hasText: "Smoke page 1" }).waitFor({ timeout: 10_000 });
});

await step("going to a page", async () => {
  await page.locator('.thumb[data-thumb="3"]').click();
  await page.waitForFunction(() => window.jurapdfStore.getState().currentPage === 2);
  // It stays on page 3 once the view has settled, though page 3 (the last) can't scroll to the top.
  await page.waitForTimeout(400);
  expect((await page.evaluate(() => window.jurapdfStore.getState().currentPage)) === 2, "should stay on page 3");
  // (The box updates when the screen next redraws, so wait for it rather than read it straight away.)
  await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]')?.value === "3", null, { timeout: 5000 }).catch(() => {
    throw new Error("page box should say 3");
  });
  const page3 = await page.locator('.page[data-page="3"]').boundingBox();
  expect(page3 && page3.y < 400, "page 3 should be scrolled into view");
  await page.keyboard.press("Home");
  await page.waitForFunction(() => window.jurapdfStore.getState().currentPage === 0);
  const box = page.getByLabel("Page number");
  await box.fill("2");
  await box.press("Enter");
  await page.waitForFunction(() => window.jurapdfStore.getState().currentPage === 1);
});

await step("zooming", async () => {
  const before = await page.locator('.page[data-page="1"]').boundingBox();
  await page.getByRole("button", { name: "100%" }).click();
  await page.waitForFunction(() => window.jurapdfStore.getState().shownZoom === 1);
  const real = await page.locator('.page[data-page="1"]').boundingBox();
  expect(Math.abs(real.width - (595 * 96) / 72) < 2, `at 100% an A4 page should be ${Math.round((595 * 96) / 72)} px wide, not ${real.width}`);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForFunction(() => window.jurapdfStore.getState().shownZoom === 1.1);
  // The page being read stays the same while zooming.
  expect((await page.evaluate(() => window.jurapdfStore.getState().currentPage)) === 1, "zooming should stay on page 2");
  const zoom = page.getByLabel("Zoom", { exact: true });
  await zoom.fill("50%");
  await zoom.press("Enter");
  await page.waitForFunction(() => window.jurapdfStore.getState().shownZoom === 0.5);
  await page.getByRole("button", { name: "Fit to width" }).click();
  const after = await page.locator('.page[data-page="1"]').boundingBox();
  expect(Math.abs(after.width - before.width) < 2, "Fit to width should go back to the size it opened at");
  // Sharp again once the zoom settles.
  await page.waitForFunction(() => {
    const c = document.querySelector('.page[data-page="2"] canvas');
    const p = c?.parentElement?.parentElement;
    return c && p && Math.abs(c.width / window.devicePixelRatio - p.clientWidth) < 3;
  });
});

await step("hiding and showing the page list", async () => {
  await page.getByRole("button", { name: "Page list" }).click();
  expect((await page.locator(".thumbnails").count()) === 0, "the page list should hide");
  await page.getByRole("button", { name: "Page list" }).click();
  await page.locator(".thumbnails").waitFor();
});

await step("making the side panel wider by dragging its edge", async () => {
  const panelWidth = async () => (await page.locator(".side-panel").boundingBox()).width;
  const thumbWidth = async () => (await page.locator('.thumb[data-thumb="1"] .thumb-picture').boundingBox()).width;
  const before = await panelWidth();
  const edge = await page.locator(".side-resize").boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
  await page.mouse.down();
  await page.mouse.move(edge.x + 120, edge.y + 200, { steps: 5 });
  await page.mouse.up();
  const after = await panelWidth();
  expect(Math.abs(after - before - 116) < 6, `the panel should be about 116px wider: ${before} → ${after}`);
  await page.waitForFunction((w) => document.querySelector('.thumb[data-thumb="1"] .thumb-picture').getBoundingClientRect().width > w, before - 40);
  expect((await thumbWidth()) > before - 40, "the page pictures should grow with the panel");
  expect((await page.evaluate(() => localStorage.getItem("jurapdf.sideWidth")))?.includes(`"pages":${Math.round(after)}`), "the width should be remembered");
  // A double-click on the edge goes back to the usual width.
  await page.locator(".side-resize").dblclick();
  await page.waitForFunction((w) => Math.abs(document.querySelector(".side-panel").getBoundingClientRect().width - w) < 2, before);
});

await step("saving", async () => {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save", exact: true }).click()]);
  expect(download.suggestedFilename() === "Smoke test.pdf", `saved as ${download.suggestedFilename()}`);
  const saved = await readFile(await download.path());
  expect(saved.equals(pdf), "the saved PDF should be the same as the one opened");
  await page.locator(".save-state", { hasText: "Saved" }).waitFor();
});

await step("adding a watermark, undo and redo, and saving it", async () => {
  await page.getByRole("button", { name: "Watermark" }).click();
  const dialog = page.getByRole("dialog", { name: "Watermark" });
  await dialog.waitFor();
  await dialog.getByLabel("Watermark words").fill("SMOKE DRAFT");
  // The preview is a real page with the watermark in it.
  await page.waitForFunction(() => !!document.querySelector(".watermark-preview-page canvas"), null, { timeout: 15_000 });
  if (process.env.SMOKE_SCREENSHOT) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: "smoke-watermark.png" });
  }
  await dialog.getByRole("button", { name: "Add to every page" }).click();
  await dialog.waitFor({ state: "detached", timeout: 15_000 });
  await page.getByText("Unsaved changes").waitFor();
  // The words are really in the pages now: they can be selected like the page's own.
  await page.locator('.page[data-page="1"] .textLayer span', { hasText: "SMOKE DRAFT" }).waitFor({ timeout: 15_000 });
  expect((await page.locator(".page").count()) === 3, "still 3 pages");
  await page.keyboard.press("Control+z");
  await page.locator('.page[data-page="1"] .textLayer span', { hasText: "SMOKE DRAFT" }).waitFor({ state: "detached", timeout: 15_000 });
  await page.keyboard.press("Control+y");
  await page.locator('.page[data-page="1"] .textLayer span', { hasText: "SMOKE DRAFT" }).waitFor({ timeout: 15_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save", exact: true }).click()]);
  const saved = await readFile(await download.path());
  expect(saved.subarray(0, 5).toString() === "%PDF-" && !saved.equals(pdf), "the saved PDF should be a new PDF with the watermark");
  await page.getByText("Unsaved changes").waitFor({ state: "detached" });
});

await step("printing with an Uncontrolled Document watermark and words of your own", async () => {
  await page.getByRole("button", { name: "Print" }).click();
  const dialog = page.getByRole("dialog", { name: "Print" });
  await dialog.waitFor();
  await dialog.getByRole("checkbox").check();
  await dialog.getByLabel("Text", { exact: true }).fill("Work Order W245354");
  // The preview shows the red watermark.
  const redIn = (selector) =>
    page.evaluate((sel) => {
      const c = document.querySelector(sel);
      if (!c) return 0;
      let d;
      if (c instanceof HTMLCanvasElement) d = c.getContext("2d").getImageData(0, 0, c.width, c.height);
      else {
        const k = document.createElement("canvas");
        k.width = c.naturalWidth;
        k.height = c.naturalHeight;
        k.getContext("2d").drawImage(c, 0, 0);
        d = k.getContext("2d").getImageData(0, 0, k.width, k.height);
      }
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) if (d.data[i] > 200 && d.data[i] - d.data[i + 1] > 30 && d.data[i] - d.data[i + 2] > 30) n++;
      return n / (d.width * d.height);
    }, selector);
  await page.waitForFunction(() => !!document.querySelector(".print-preview-page canvas"));
  await page.waitForTimeout(400);
  expect((await redIn(".print-preview-page canvas")) > 0.005, "the preview should show the red watermark");
  // Choose pages 1 and 3.
  await dialog.getByRole("radio", { name: "Choose" }).click();
  await dialog.getByLabel("Pages to print").last().fill("1, 3");
  await dialog.getByRole("button", { name: "Print 2 pages" }).click();
  await dialog.waitFor({ state: "detached", timeout: 30_000 });
  // The pages handed to the browser's print window: two pictures, sized as their pages, with the watermark.
  const frame = page.frameLocator("iframe[aria-hidden=true]");
  await frame.locator("img").nth(1).waitFor({ state: "attached" });
  const imgs = await page.evaluate(() => {
    const doc = document.querySelector("iframe[aria-hidden=true]").contentDocument;
    return Array.from(doc.images).map((i) => [i.naturalWidth, i.naturalHeight]);
  });
  expect(imgs.length === 2, `expected 2 printed pages, got ${imgs.length}`);
  expect(imgs[1][0] > imgs[1][1], "page 3 should print landscape");
  const red = await page.evaluate(() => {
    const img = document.querySelector("iframe[aria-hidden=true]").contentDocument.images[0];
    const k = document.createElement("canvas");
    k.width = img.naturalWidth;
    k.height = img.naturalHeight;
    const ctx = k.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, k.width, k.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i] - d[i + 1] > 30 && d[i] - d[i + 2] > 30) n++;
    return n / (k.width * k.height);
  });
  expect(red > 0.005, "the printed page should carry the red watermark");
  // The next print remembers the tick and the words.
  await page.keyboard.press("Control+p");
  await dialog.waitFor();
  expect(await dialog.getByRole("checkbox").isChecked(), "Uncontrolled Document should stay ticked");
  expect((await dialog.getByLabel("Text", { exact: true }).inputValue()) === "Work Order W245354", "the words should be kept");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
});

await step("help opens and closes", async () => {
  await page.keyboard.press("?");
  await page.getByRole("dialog", { name: "Help and shortcuts" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Help and shortcuts" }).waitFor({ state: "detached" });
});

await step("a file that isn't a PDF is turned away kindly", async () => {
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["hello"], "notes.txt", { type: "text/plain" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.getByText("notes.txt isn't a PDF").waitFor();
  // The PDF that was open is still there.
  expect((await page.locator(".page").count()) === 3, "the open PDF should stay open");
});

await step("changing pages: pick, turn, drag to move, delete, add, bring in and save some as a new PDF", async () => {
  const st = () => page.evaluate(() => {
    const s = window.jurapdfStore.getState();
    return { selected: s.selected, sizes: s.pdf.sizes, current: s.currentPage, label: s.past.at(-1)?.label };
  });
  // Waits for page n's words to be redrawn as `words` (they're drawn again after each change).
  const wordsAre = (n, words) =>
    page
      .waitForFunction(([n, words]) => document.querySelector(`.page[data-page="${n}"] .textLayer`)?.textContent?.includes(words), [n, words], { timeout: 15_000 })
      .then(() => true, () => false);
  const pagesIn = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();
  const thumb = (n) => page.locator(`.thumb[data-thumb="${n}"]`);

  // Pick pages 1 and 3.
  await thumb(1).click();
  await thumb(3).click({ modifiers: ["Control"] });
  expect(JSON.stringify((await st()).selected) === "[0,2]", `pages 1 and 3 should be picked, not ${JSON.stringify((await st()).selected)}`);
  await page.locator(".thumbs-picked", { hasText: "2 pages picked" }).waitFor();
  if (process.env.SMOKE_SCREENSHOT) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: "smoke-pages.png" });
  }

  // Turn them a quarter turn: page 1 (A4 upright) lies on its side, page 3 (landscape) stands up.
  await page.getByRole("button", { name: "Turn right" }).click();
  await page.waitForFunction(() => window.jurapdfStore.getState().past.at(-1)?.label === "turn pages 1 and 3");
  let now = await st();
  expect(now.sizes[0][0] > now.sizes[0][1] && now.sizes[2][0] < now.sizes[2][1], `pages 1 and 3 should be turned: ${JSON.stringify(now.sizes)}`);
  expect(JSON.stringify(now.selected) === "[0,2]", "the pages should stay picked");
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.jurapdfStore.getState().pdf.sizes[0][0] < window.jurapdfStore.getState().pdf.sizes[0][1]);

  // Drag page 3 to the top.
  await thumb(3).click();
  await thumb(3).dragTo(thumb(1), { targetPosition: { x: 60, y: 10 } });
  await page.waitForFunction(() => window.jurapdfStore.getState().past.at(-1)?.label === "move page 3");
  expect((await wordsAre(1, "Smoke page 3")), "page 3 should now be first");
  expect((await wordsAre(2, "Smoke page 1")), "page 1 should now be second");

  // Move it back down with the button (it's still the page being read).
  expect((await st()).current === 0, "the moved page should be the one being read");
  await page.getByRole("button", { name: "Move down" }).click();
  await page.waitForFunction(() => window.jurapdfStore.getState().past.at(-1)?.label === "move page 1 down");
  expect((await wordsAre(1, "Smoke page 1")) && (await wordsAre(2, "Smoke page 3")), "page 1 should be first again, with page 3 after it");
  // Undo both moves.
  for (let i = 0; i < 2; i++) await page.keyboard.press("Control+z");
  expect((await wordsAre(1, "Smoke page 1")) && (await wordsAre(3, "Smoke page 3")), "Undo should put the pages back in order");

  // Pick page 2 and delete it with the Delete key; Undo brings it back.
  await thumb(2).click({ modifiers: ["Control"] });
  await thumb(2).click({ modifiers: ["Control"] }); // a second Ctrl-click un-picks it...
  await thumb(1).click();
  await thumb(2).click({ modifiers: ["Shift"] }); // ...and Shift-click picks a run: pages 1 and 2
  expect(JSON.stringify((await st()).selected) === "[0,1]", `pages 1 and 2 should be picked, not ${JSON.stringify((await st()).selected)}`);
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => window.jurapdfStore.getState().pdf.sizes.length === 1);
  await page.getByText("Deleted pages 1 and 2").waitFor();
  expect((await wordsAre(1, "Smoke page 3")), "only page 3 should be left");
  expect(await page.getByRole("button", { name: "Delete pages" }).isDisabled(), "the last page can't be deleted");
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.jurapdfStore.getState().pdf.sizes.length === 3);

  // Add a blank page after page 3 (landscape, like it).
  await thumb(3).click();
  await page.getByRole("button", { name: "Add a blank page" }).click();
  await page.waitForFunction(() => window.jurapdfStore.getState().pdf.sizes.length === 4);
  now = await st();
  expect(now.sizes[3][0] === 842 && now.sizes[3][1] === 595 && now.current === 3, `a landscape blank page 4 should be added and shown: ${JSON.stringify(now)}`);

  // Bring in the pages of another PDF after page 1.
  await thumb(1).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Bring in pages from another PDF" }).click()]);
  await chooser.setFiles({ name: "Other.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.waitForFunction(() => window.jurapdfStore.getState().pdf.sizes.length === 7, null, { timeout: 15_000 });
  await page.getByText("Brought in 3 pages from Other.pdf").waitFor();
  expect(JSON.stringify((await st()).selected) === "[1,2,3]", "the pages brought in should be picked");
  expect((await wordsAre(2, "Smoke page 1")) && (await wordsAre(3, "Smoke page 2")), "the new pages should come after page 1");

  // Save the picked pages as a new PDF of their own.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save pages as a new PDF" }).click()]);
  expect(download.suggestedFilename() === "Smoke test (3 pages).pdf", `saved as ${download.suggestedFilename()}`);
  const part = await readFile(await download.path());
  const partPages = await pagesIn(part);
  expect(partPages === 3, `the new PDF should have 3 pages, not ${partPages}`);
  // Back to the 3 pages the next steps expect.
  for (let i = 0; i < 2; i++) await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.jurapdfStore.getState().pdf.sizes.length === 3);
  await page.keyboard.press("Escape");
});

await step("one whole page at a time: the wheel and keys flip pages", async () => {
  const current = () => page.evaluate(() => window.jurapdfStore.getState().currentPage);
  await page.keyboard.press("Home");
  await page.waitForFunction(() => window.jurapdfStore.getState().currentPage === 0);
  await page.getByRole("button", { name: "One page at a time" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".page").length === 1);
  // The whole page fits in the window.
  const box = await page.locator(".page").boundingBox();
  const view = await page.locator(".page-scroller").boundingBox();
  expect(box.height <= view.height && box.width <= view.width, "the whole page should fit in the window");
  // The wheel flips to the next page.
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => window.jurapdfStore.getState().currentPage === 1, null, { timeout: 5000 });
  await page.locator('.page[data-page="2"]').waitFor();
  expect((await page.locator(".page").count()) === 1, "still one page showing");
  // Page Down and the arrow keys flip too.
  await page.waitForTimeout(400);
  await page.keyboard.press("PageDown");
  await page.waitForFunction(() => window.jurapdfStore.getState().currentPage === 2);
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => window.jurapdfStore.getState().currentPage === 1);
  await page.mouse.wheel(0, -120);
  await page.waitForFunction(() => window.jurapdfStore.getState().currentPage === 0, null, { timeout: 5000 });
  expect((await current()) === 0, "back on page 1");
  // And back to pages one under another.
  await page.getByRole("button", { name: "One page at a time" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".page").length === 3);
});

await step("bookmarks: add, rename, go to, move inside another, and Undo", async () => {
  const label = () => page.evaluate(() => window.jurapdfStore.getState().past.at(-1)?.label);
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await page.getByText("This PDF has no bookmarks yet").waitFor();
  // Bookmark page 1 and name it straight away.
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "Add a bookmark" }).click();
  const box = page.getByRole("textbox", { name: "Bookmark name" });
  await box.waitFor();
  await box.fill("Start here");
  await box.press("Enter");
  await page.waitForFunction(() => window.jurapdfStore.getState().past.at(-1)?.label === "rename bookmark to “Start here”");
  // Bookmark page 3, keeping the name it's given.
  await page.keyboard.press("End");
  await page.waitForFunction(() => window.jurapdfStore.getState().currentPage === 2);
  await page.getByRole("button", { name: "Add a bookmark" }).click();
  await page.getByRole("textbox", { name: "Bookmark name" }).press("Escape");
  const rows = page.getByRole("treeitem");
  expect((await rows.count()) === 2, "two bookmarks");
  expect((await rows.nth(0).textContent()).includes("Start here") && (await rows.nth(1).textContent()).includes("Page 3"), "in page order");
  // Clicking a bookmark goes to its page.
  await page.keyboard.press("Home");
  await page.waitForFunction(() => window.jurapdfStore.getState().currentPage === 0);
  await page.getByRole("button", { name: /^Page 3/ }).click();
  await page.waitForFunction(() => window.jurapdfStore.getState().currentPage === 2);
  // Put "Page 3" inside "Start here".
  await page.getByRole("button", { name: "Put it inside the one above" }).click();
  await page.waitForFunction(() => document.querySelector('[role="treeitem"][aria-level="2"]')?.textContent?.includes("Page 3"));
  expect((await label()) === "move bookmark", "moving is an undo step");
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: "smoke-bookmarks.png" });
  // They're written into the PDF.
  const bytes = Buffer.from(await page.evaluate(() => Array.from(window.jurapdfStore.getState().pdf.bytes)));
  const doc = await PDFDocument.load(bytes);
  const outlines = doc.catalog.lookup(PDFName.of("Outlines"), PDFDict);
  expect(outlines.lookup(PDFName.of("First"), PDFDict).lookup(PDFName.of("Title")).decodeText() === "Start here", "the PDF holds the bookmarks");
  // Undo takes them all away again (two adds, a rename and a move).
  for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
  await page.getByText("This PDF has no bookmarks yet").waitFor();
  await page.getByRole("tab", { name: "Pages" }).click();
  await page.locator(".thumbnails").waitFor();
});

await step("adding words and a picture to pages", async () => {
  const label = () => page.evaluate(() => window.jurapdfStore.getState().past.at(-1)?.label);
  // Words: click the button, click on page 1, type, Done.
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "Add words" }).click();
  const p1 = await page.locator('.page[data-page="1"]').boundingBox();
  await page.mouse.click(p1.x + p1.width * 0.2, p1.y + p1.height * 0.5);
  const box = page.getByRole("textbox", { name: "Words to add" });
  await box.waitFor();
  await page.keyboard.type("Checked by Kevin");
  await page.getByRole("combobox", { name: "Font" }).selectOption("HelveticaBold");
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForFunction(() => window.jurapdfStore.getState().past.at(-1)?.label === "add “Checked by Kevin” to page 1");
  await page.waitForFunction(() => document.querySelector('.page[data-page="1"] .textLayer')?.textContent?.includes("Checked by Kevin"), null, { timeout: 15_000 });
  // The words land where they were typed: about a fifth of the way across the page.
  const spot = await page.evaluate(() => {
    const span = [...document.querySelectorAll('.page[data-page="1"] .textLayer span')].find((s) => s.textContent.includes("Checked"));
    const pageBox = document.querySelector('.page[data-page="1"]').getBoundingClientRect();
    const r = span.getBoundingClientRect();
    return { across: (r.left - pageBox.left) / pageBox.width, down: (r.top + r.height / 2 - pageBox.top) / pageBox.height };
  });
  expect(Math.abs(spot.across - 0.2) < 0.02 && Math.abs(spot.down - 0.5) < 0.03, `the words should be where the page was clicked: ${JSON.stringify(spot)}`);

  // A picture: choose it, click on page 2, make it bigger by its corner, Done.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAN/gH/w+1JvwAAAABJRU5ErkJggg==", "base64");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Add a picture" }).click()]);
  await chooser.setFiles({ name: "Stamp.png", mimeType: "image/png", buffer: png });
  await page.getByText("Click on a page where the picture should go").waitFor();
  await page.locator('.page[data-page="2"]').scrollIntoViewIfNeeded();
  const p2 = await page.locator('.page[data-page="2"]').boundingBox();
  await page.mouse.click(p2.x + p2.width / 2, p2.y + p2.height / 2);
  await page.locator(".draft-picture").waitFor();
  const before = await page.locator(".draft-picture").boundingBox();
  const corner = await page.locator(".draft-size").boundingBox();
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + corner.width / 2 + 60, corner.y + 200, { steps: 4 });
  await page.mouse.up();
  const after = await page.locator(".draft-picture").boundingBox();
  expect(Math.abs(after.width - before.width - 60) < 3 && Math.abs(after.width / after.height - 2) < 0.05, `the picture should grow, keeping its shape: ${JSON.stringify([before, after])}`);
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: "smoke-add.png" });
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForFunction(() => window.jurapdfStore.getState().past.at(-1)?.label === "add a picture to page 2");
  expect((await page.locator(".draft").count()) === 0, "nothing left waiting to be added");

  // Esc stops adding; Undo takes both back.
  await page.getByRole("button", { name: "Add words" }).click();
  await page.keyboard.press("Escape");
  expect(!(await page.evaluate(() => window.jurapdfStore.getState().placing)), "Esc stops adding words");
  for (let i = 0; i < 2; i++) await page.keyboard.press("Control+z");
  await page.waitForFunction(() => !document.querySelector('.page[data-page="1"] .textLayer')?.textContent?.includes("Checked by Kevin"), null, { timeout: 15_000 });
  expect((await label()) !== "add a picture to page 2", "Undo takes the picture back");
});

await step("Connect to Claude with no extension running says what to do", async () => {
  await page.getByRole("button", { name: "Connect to Claude" }).click();
  await page.locator('.modal:has-text("Not connected")').waitFor({ timeout: 60_000 });
  expect((await page.locator(".modal .help-steps li").count()) >= 3, "advice on what to do when Claude isn't there");
  await page.keyboard.press("Escape");
});

// With the extension built (CI builds it before this test): start it the way Claude does, connect, and let
// "Claude" (this test, talking MCP to it) change the open PDF, which must show in the tab.
const extensionServer = "build/claude-extension/server/index.mjs";
if (existsSync(extensionServer)) {
  await step("Live with Claude: Claude changes the open PDF", async () => {
    const folder = mkdtempSync(join(tmpdir(), "jurapdf-smoke-live-"));
    // JURAPDF_LIVE_DEV=1: this test serves JuraPDF from 127.0.0.1, which the shipped extension otherwise turns away.
    const ext = spawn(process.execPath, [extensionServer, folder], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, JURAPDF_LIVE_DEV: "1" } });
    let extLog = "";
    ext.stderr.on("data", (d) => (extLog += d));
    const replies = new Map();
    let pending = "";
    ext.stdout.on("data", (d) => {
      pending += d;
      let nl;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        if (line) {
          const msg = JSON.parse(line);
          replies.get(msg.id)?.(msg);
        }
      }
    });
    let nextId = 1;
    const mcp = (method, params) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => reject(new Error(`The extension didn't answer ${method}\n${extLog.slice(-1500)}`)), 60_000);
        replies.set(id, (m) => {
          clearTimeout(timer);
          resolve(m);
        });
        ext.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    const tool = async (name, args = {}) => {
      const r = await mcp("tools/call", { name, arguments: args });
      const text = (r.result?.content ?? []).map((c) => c.text).join("\n");
      return { text, failed: !!(r.error || r.result?.isError) };
    };
    const done = async (name, args) => {
      const r = await tool(name, args);
      if (r.failed) throw new Error(`${name} failed: ${r.text}`);
      return r.text;
    };
    const get = (fn) => page.evaluate(fn);
    try {
      await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
      ext.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      for (let i = 0; i < 100 && !/Live link ready/.test(extLog); i++) await new Promise((r) => setTimeout(r, 100));
      expect(/Live link ready/.test(extLog), `the extension's live link starting:\n${extLog.slice(-1500)}`);
      await page.getByRole("button", { name: "Connect to Claude" }).click();
      await page.locator(".live-badge").waitFor({ timeout: 30_000 });
      const stepsBefore = await get(() => window.jurapdfStore.getState().past.length);
      const described = await done("describe_pdf");
      expect(/Smoke test\.pdf: 3 pages/.test(described) && /Page 1: Smoke page 1/.test(described), `Claude seeing the PDF that's open in the tab:\n${described}`);
      const said = await done("turn_pages", { pages: 2, direction: "right" });
      expect(/Live: this now shows in the user's open JuraPDF tab/.test(said), `Claude being told its change is on show:\n${said}`);
      await page.waitForFunction(() => {
        const [w, h] = window.jurapdfStore.getState().pdf.sizes[1];
        return w > h;
      }, null, { timeout: 15_000 });
      await done("add_blank_pages", { after: "end" });
      await page.waitForFunction(() => window.jurapdfStore.getState().pdf.sizes.length === 4, null, { timeout: 15_000 });
      expect((await get(() => window.jurapdfStore.getState().past.length)) === stepsBefore + 2, "each of Claude's changes being one undo step");
      await page.locator(".toast", { hasText: "Claude: added a blank page" }).waitFor();
      // The user undoes Claude's blank page; Claude sees the PDF as it now is.
      await page.keyboard.press("Control+z");
      await page.waitForFunction(() => window.jurapdfStore.getState().pdf.sizes.length === 3);
      let look = "";
      for (let i = 0; i < 50 && !/: 3 pages/.test((look = await done("describe_pdf", { words: false }))); i++) await new Promise((r) => setTimeout(r, 100));
      expect(/: 3 pages/.test(look), `Claude seeing that its page was undone:\n${look}`);
      // With the Watermark window open Claude waits: its change is turned back and nothing is lost.
      await page.getByRole("button", { name: "Watermark" }).click();
      await page.getByRole("dialog", { name: "Watermark" }).waitFor();
      const refused = await tool("delete_pages", { pages: 3 });
      expect(refused.failed && /Watermark window open/.test(refused.text), `Claude's change being turned back while the Watermark window is open:\n${refused.text}`);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Watermark" }).waitFor({ state: "detached" });
      await done("add_watermark", { words: "FROM CLAUDE", pages: 1 });
      await page.locator('.page[data-page="1"] .textLayer span', { hasText: "FROM CLAUDE" }).waitFor({ timeout: 15_000 });
      // Disconnect from the badge.
      await page.locator(".live-badge").click();
      await page.locator(".modal button", { hasText: "Disconnect" }).click();
      await page.getByRole("button", { name: "Connect to Claude" }).waitFor();
      for (let i = 0; i < 50 && !/Live: not connected/.test(await done("live_status")); i++) await new Promise((r) => setTimeout(r, 100));
      expect(/Live: not connected/.test(await done("live_status")), "the extension knowing the tab has gone");
      // Back to the PDF the next steps expect.
      for (let i = 0; i < 2; i++) await page.keyboard.press("Control+z");
      await page.waitForFunction(() => {
        const s = window.jurapdfStore.getState();
        return s.pdf.sizes.length === 3 && s.pdf.sizes[1][0] < s.pdf.sizes[1][1];
      });
    } finally {
      ext.kill();
      rmSync(folder, { recursive: true, force: true });
    }
  });
} else console.log("(The Claude extension isn't built, so Live with Claude wasn't tried: npm run build:claude first.)");

await step("dark mode", async () => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "should be dark");
  await page.getByRole("radio", { name: "Light" }).click();
  await page.keyboard.press("Escape");
});

if (process.env.SMOKE_SCREENSHOT) {
  await page.screenshot({ path: "smoke.png" });
  console.log("Saved smoke.png");
}

for (const p of problems) {
  failed = true;
  annotate("error", "Smoke test", p);
}

await browser.close();
server.close();
if (failed) process.exit(1);
console.log("Smoke test passed.");
