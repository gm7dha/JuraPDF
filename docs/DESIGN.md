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
| Writing PDFs (from v0.2) | `pdf-lib` (MIT) | Adds pages, words, pictures and drawing to existing PDFs in the browser |
| Edits | Kept as a list of changes, applied to the original file when saving | The original is never damaged; edits can be undone |
| Units | PDF points (1/72 in); 100% zoom = real size (96 CSS px per inch) | As Chrome's and Adobe's viewers |
| Delivery | PWA on GitHub Pages; opens `.pdf` files once installed | Installs on Windows and macOS, offline, free |
| Licence | MIT | Simple |

## Architecture

```
src/model      zoom.ts (zoom and page layout maths), pdfFile.ts (recognising and naming PDFs), store.ts
src/pdf        pdfjs.ts (loading, drawing pages and their words with pdf.js)
src/app        React: TopBar, ViewBar, Thumbnails, PageView, HelpDialog, PasswordDialog, App
tests          Vitest, pure code only;  scripts/smoke-test.mjs drives the built app in headless Chromium
```

## Roadmap

- **v0.1 (done)** — the viewer: open (button, drag and drop, double-click once installed), password-protected PDFs,
  page list, page numbers, zoom (fit width, whole page, real size, Ctrl + scroll), selectable words, save, install,
  light/dark.
- **v0.2** — **watermarks**: words or a picture (PNG/JPG, e.g. a logo); font, size, colour, see-through amount, angle
  (diagonal by default), position (nine spots, or tiled across the page), which pages (all, odd, even, a range), in
  front of or behind the page; live preview on the real pages; saved presets. An option to turn each page into a
  picture so the watermark can't be lifted off (says plainly that the words then can't be selected).
- **v0.3** — **pages**: add blank pages, delete, drag to reorder in the page list, rotate, bring in pages from another
  PDF, join several PDFs, split or save chosen pages as a new PDF. Undo and redo for everything.
- **v0.4** — **editing**: add words (text boxes), pictures and shapes (lines, boxes, arrows, highlights); move, resize,
  replace or delete pictures already on a page; fix words already on a page (the old words are covered with the page's
  background and the new ones written in the closest matching font; short fixes only, as PDFs don't reflow).
- **v0.5** — **bring in and save out**: pictures (JPG/PNG) to new pages; pages to PNG/JPG; all the words out as text.
- **v0.6** — **printing**: page range, fit to paper, how many copies (through the browser's print window).
- **Later** — recent files, keeping work in the browser between visits, a Claude extension (as JuraCAD's and
  JuraDAW's), comments and highlights, compressing large PDFs.
