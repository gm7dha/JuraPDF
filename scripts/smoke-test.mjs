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
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";

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
page.on("console", (msg) => {
  if (msg.type() === "error") problems.push(`Console error: ${msg.text()}`);
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
