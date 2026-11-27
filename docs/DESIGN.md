# JuraPDF — Design

JuraPDF is a free, open-source, browser-based **PDF viewer and editor**. It is the sister program of JuraCAD, JuraCUT
and JuraDAW: the same stack, look, install flow and ways of working.

**Who it's for:** someone who wants to read PDFs and make everyday changes to them (watermark them, add or take out
pages, fix a word, swap a picture, print) without paying for Acrobat or uploading private files to a website. Every
trade-off favours being easy to find your way round over professional depth.

## Goals

- Open any PDF and show it faithfully and quickly, however long it is.
- Make changes that are saved into a normal PDF that opens anywhere.
- Never upload anything: all the work happens in the browser. Works offline once installed.

**Not goals (for now):** filling and designing forms, digital signatures, optical character recognition (reading words
from scanned pages), real-time collaboration or cloud storage.

## Key decisions

| Area | Decision | Why |
| --- | --- | --- |
| Language and build | TypeScript, Vite | As the sister apps |
| UI | React + Zustand | As the sister apps |
| Reading and drawing PDFs | Mozilla's pdf.js (`pdfjs-dist`, Apache 2.0) in a worker | The most faithful free PDF renderer for browsers; writing one is not realistic |
| Writing PDFs (from v0.3) | `pdf-lib` (MIT) | Adds pages, words, pictures and drawing to existing PDFs in the browser |
| Reading words in pictures (from v0.6.4) | Tesseract (`tesseract.js` and its English data, Apache 2.0) in a worker | Kevin chose it (2026-11-25): the standard free reader; its ~7 MB of files ship with the app under `ocr/` and are fetched only when first used, then work offline |
| Edits | Kept as a list of changes, applied to the original file when saving | The original is never damaged; edits can be undone |
| Units | PDF points (1/72 in); 100% zoom = real size (96 CSS px per inch) | As Chrome's and Adobe's viewers |
| Delivery | PWA on GitHub Pages; opens `.pdf` files once installed | Installs on Windows and macOS, offline, free |
| Licence | MIT | Simple |

## Architecture

```
src/model      zoom.ts (zoom and page layout maths), pdfFile.ts (recognising and naming PDFs), printMark.ts (print watermark layout, page ranges), pages.ts (picking pages, new page orders), store.ts
src/model      watermark.ts (watermark choices and where each copy goes, turned pages included)
src/pdf        pdfjs.ts (loading, drawing pages and their words with pdf.js), watermark.ts (writing watermarks with pdf-lib), pages.ts (page changes with pdf-lib)
src/mcp        the Claude extension: server.ts, tools.ts, reading.ts (pdf.js in Node), session, live.ts, websocket.ts, files.ts
src/live       Live with Claude, shared by the app and the extension (protocol, client, Safari's link window)
src/app        React: TopBar (+ LiveButton, liveLink.ts), ViewBar (+ pageActions.ts), Thumbnails, PageView, PrintDialog (+ printing.ts), HelpDialog, PasswordDialog, App
tests          Vitest, pure code only;  scripts/smoke-test.mjs drives the built app in headless Chromium
```

## Roadmap

- **v0.1 (done)** — the viewer: open (button, drag and drop, double-click once installed), password-protected PDFs,
  page list, page numbers, zoom (fit width, whole page, real size, Ctrl + scroll), selectable words, save, install,
  light/dark.
- **v0.2 (done)** — **printing with a watermark** (the owner's first need, brought forward): all / current / chosen
  pages, each on paper of its own size; tick "Uncontrolled Document" and/or type your own Text (e.g. a work order number), written
  see-through red corner to corner across every printed page (pages are printed as 150 dpi pictures with the mark drawn
  on, as Firefox's viewer prints). Only the printout is marked.
- **v0.3 (done)** — **watermarks saved into the PDF**, with Undo/Redo: words or a picture (PNG/JPG, e.g. a logo); font, size, colour, see-through amount, angle
  (diagonal by default), position (nine spots, or tiled across the page), which pages (all, odd, even, a range), in
  front of or behind the page; live preview on the real pages; saved presets. An option to turn each page into a
  picture so the watermark can't be lifted off (says plainly that the words then can't be selected).
- **v0.4 (done)** — **pages**: pick pages in the page list (Ctrl/⌘-click, Shift-click), add blank pages, delete, drag
  to reorder or move up/down, turn, bring in pages from another PDF (joining), save chosen pages as a new PDF
  (splitting). Undo and redo for everything.
- **v0.5 (done)** — **JuraPDF with Claude** (asked for by the owner, as JuraCAD's and JuraDAW's): an extension for
  the Claude desktop app with tools to read, watermark and change pages of PDFs in a chosen folder, and Live with
  Claude on the PDF open in the tab.
- **v0.5.1 (done)** — **bookmarks** (asked for by the owner): a Bookmarks tab beside Pages in the side panel showing
  the PDF's outline (folding, the bookmark for the page being read marked); add one for the page being read, rename,
  delete, point at this page, move up/down/in/out. Written into the PDF's outline with pdf-lib, an undo step each.
- **v0.6 (done)** — **add words and pictures**: click on a page to place typed words (font, size, colour, several
  lines) or a PNG/JPG picture (drag to move, corner to size), Done writes them into the page; Claude's add_words and
  add_picture tools.
- **v0.6.2–v0.6.4 (done)** — shapes and highlights (v0.6.2); quicker one-page flips and Highlight for words picked
  with the mouse (v0.6.3); reading the words in pictures (scans, photos) so they can be picked and copied (v0.6.4).
- **v0.6.5 (done)** — **change what's already on a page**: move, resize, swap or delete pictures already on a page; fix
  words already on a page (the old words are covered with white and the new ones written in the closest matching font;
  short fixes only, as PDFs don't reflow).
- **v0.7 (done)** — **bring in and save out**: pictures (JPG/PNG) to new pages; pages to PNG (several in a zip); all the
  words out as text.
- **v0.7.1 (done)** — scanned pages unpacked by the browser (about ten times quicker), and one page at a time
  reads three pages ahead in the direction you're flicking.
- **v0.7.2 (done)** — **find words** (asked for by the owner): a search bar (Ctrl+F) that looks through every page,
  colours in each place found, counts them and goes to the next / previous one on any page; capitals and accents
  don't matter unless asked; looks again after every change; points out pages with no words (scans) and offers to
  read them.
- **v0.8 (done)** — **better editing** (asked for by the owner, "like Acrobat or Preview"): everything JuraPDF adds
  stays changeable (marked in the page and remembered, see CLAUDE.md); fixed words keep the PDF's own font, size and
  colour; filled and see-through shapes; freehand pen; underline and cross out picked words; colour swatches; tool
  shortcuts; nudge, copy, delete; Ctrl+Z within what's being placed.
- **Next** — **fillable forms** (asked for by the owner, as in Tungsten PDF): add text boxes, tick boxes and the like
  that Acrobat and other readers can fill in.
- **Later** — recent files, keeping work in the browser between visits, comments and highlights, compressing large PDFs.
