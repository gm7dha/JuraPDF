# JuraPDF

**Free, open-source, browser-based PDF viewer and editor. Your files never leave your computer.**

▶ **Use it:** https://gm7dha.github.io/JuraPDF/ (Chrome or Edge recommended)

JuraPDF runs entirely in your browser. There's no account, nothing is uploaded, and it's free. It's the sister app of
[JuraCAD](https://github.com/gm7dha/JuraCAD), [JuraCUT](https://github.com/gm7dha/JuraCUT) and
[JuraDAW](https://github.com/gm7dha/JuraDAW), built the same way.

> **Status: v0.3 preview.** It opens, shows and prints PDFs, adds watermarks saved into the PDF, and prints with an "Uncontrolled Document" watermark and words of your own. Adding, removing and moving pages comes next. See the [roadmap](docs/DESIGN.md#roadmap).

## What you can do today

- **Open a PDF**: the Open button, or drag it onto the window. Password-protected PDFs ask for their password.
- **Read it**: pages one under another, with a **page list** of thumbnails down the left (click one to go there).
- **Go to a page**: type its number, use the arrows, or ← / → and Home / End.
- **Zoom**: − and +, type a zoom, **Fit to width**, **Whole page** or **100%** (real size); Ctrl + scroll or a
  trackpad pinch zooms towards the pointer.
- **Select and copy words**, and find them with Ctrl + F.
- **Save** the PDF back to your computer.
- **Watermark** the pages with words or a picture: any colour, size, angle, see-through amount, in the middle, a corner
  or repeated, in front or behind, on all, odd, even or chosen pages, with a live preview. It's saved into the PDF.
- **Undo and Redo** any change.
- **Print** all pages, the current page or the pages you choose, with an optional watermark across every printed page:
  **UNCONTROLLED DOCUMENT** and/or your own **Text** (e.g. "Work Order W245354"). Only the printout is marked.
- **Install it as an app** (Chrome/Edge: the Install button) so it opens in its own window, works offline and opens
  PDFs you double-click.
- **Dark mode** (Settings ⚙): Light, Dark, or Automatic (follows your computer).

## Coming next

1. **Pages**: add, delete, reorder, rotate, bring in pages from another PDF, join files, split them up.
2. **Editing**: add words, pictures and shapes; move, replace or delete pictures; fix words already on the page.
3. **Bring in and save out**: pictures to pages, pages to pictures, copy all the words out.

## How it's built

- **TypeScript + React + Vite**, state in **Zustand**.
- Pages are drawn by Mozilla's **pdf.js** (the engine inside Firefox's PDF viewer), in a background worker so the
  window never freezes.
- Every change runs automated tests and a browser smoke test on GitHub Actions and, once merged to `main`, publishes
  to GitHub Pages.

See [docs/DESIGN.md](docs/DESIGN.md) for the design, decisions and roadmap.

### Developing

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests
npm run build      # production build into dist/
npm run smoke      # drive the built app in headless Chromium
```

## Licence

JuraPDF is MIT licensed (see [LICENSE](LICENSE)). It uses [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0,
with its standard fonts under their own free licences, shipped in `pdfjs/standard_fonts/`), [pdf-lib](https://pdf-lib.js.org) (MIT), [React](https://react.dev)
(MIT) and [Zustand](https://github.com/pmndrs/zustand) (MIT).
