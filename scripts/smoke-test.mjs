/**
 * Browser smoke test: serves the production build, opens it in headless
 * Chromium and does what a person would: drop a PDF on the window → see its
 * pages and thumbnails drawn → select its words → go to a page → zoom in and
 * out → save it. Fails on any console error. Run after `npm run build`.
 *
 * In GitHub Actions, problems are reported as annotations. SMOKE_SCREENSHOT=1
 * also saves smoke.png. CHROMIUM_PATH uses a Chromium already on the computer.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright";

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
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save" }).click()]);
  expect(download.suggestedFilename() === "Smoke test.pdf", `saved as ${download.suggestedFilename()}`);
  const saved = await readFile(await download.path());
  expect(saved.equals(pdf), "the saved PDF should be the same as the one opened");
  await page.locator(".save-state", { hasText: "Saved" }).waitFor();
});

await step("printing with an Uncontrolled Document and Work Order watermark", async () => {
  await page.getByRole("button", { name: "Print" }).click();
  const dialog = page.getByRole("dialog", { name: "Print" });
  await dialog.waitFor();
  await dialog.getByRole("checkbox").check();
  await dialog.getByLabel("Work Order").fill("W245354");
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
  // The next print remembers the tick and the work order.
  await page.keyboard.press("Control+p");
  await dialog.waitFor();
  expect(await dialog.getByRole("checkbox").isChecked(), "Uncontrolled Document should stay ticked");
  expect((await dialog.getByLabel("Work Order").inputValue()) === "W245354", "the work order should be kept");
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
