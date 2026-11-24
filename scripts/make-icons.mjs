/**
 * Makes the app icons (PNG) from public/favicon.svg, with headless Chromium:
 * icon-192.png, icon-512.png, apple-touch-icon.png (180) and
 * icon-maskable-512.png (the picture smaller, on a full square of blue, so
 * phones can crop it to their own shape). Run after changing the favicon:
 * `npm run icons`.
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const svg = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();

async function make(file, size, maskable = false) {
  await page.setViewportSize({ width: size, height: size });
  const inner = maskable ? Math.round(size * 0.78) : size;
  const html = `<html><body style="margin:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${maskable ? "#1f6fd1" : "transparent"}">
    <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`;
  await page.setContent(html);
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname, omitBackground: !maskable });
  console.log(`made public/${file}`);
}

await make("icon-192.png", 192);
await make("icon-512.png", 512);
await make("apple-touch-icon.png", 180);
await make("icon-maskable-512.png", 512, true);
await browser.close();
