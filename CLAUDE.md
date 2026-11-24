# Notes for Claude working on JuraPDF

- The owner is a hobbyist with no coding background who directs the work. Explain changes in plain English
  in pull requests, and keep the app's wording friendly and jargon-free ("page", "words", "picture", "see-through",
  never "annotation", "XObject", "opacity" or "flatten" without saying what it means).
- The owner has said to merge PRs without asking once CI passes (squash merge), then tell them what changed so
  they can try it on the live site.
- JuraPDF is the sister app of JuraCAD, JuraCUT and JuraDAW (github.com/gm7dha/…): the same stack, look, install
  flow and ways of working. When something exists in JuraCUT (a dialog, a helper, a test pattern), copy how it's done
  there: `styles.css`, `Modal`, `TopBar`'s settings menu, `popupGuard.ts`, `theme.ts`, `install.ts`, `download.ts`,
  `platform.ts`, `easterEgg.ts` and the smoke test all began as JuraCUT's. Design and roadmap: `docs/DESIGN.md`.
- Stack: TypeScript (strict, no unused locals or parameters), React 18, Vite 5, Zustand 5. PDFs are read and drawn by
  `pdfjs-dist` (pinned; `src/pdf/pdfjs.ts` is the only file that talks to it). Writing PDFs (watermarks and every edit
  after) uses `pdf-lib` (MIT, pinned), only in `src/pdf/`. No other runtime dependencies, no CDNs: everything works offline.
- pdf.js's character maps and standard fonts are served from `node_modules` in dev and copied to `dist/pdfjs/` by the
  plugin in `vite.config.ts`. The worker is imported with `?url`.
- Units: page sizes are PDF points (72 to the inch), as pdf.js gives them (already turned for rotated pages). At 100%
  a page shows at real size: `CSS_PER_PT` = 96 / 72 CSS pixels per point (`src/model/zoom.ts`).
- The page view (`src/app/PageView.tsx`) lays every page out from `layoutPages` (pure) and only draws pages near the
  window (IntersectionObserver), letting far ones go. On a zoom change the old canvas is stretched until the new one is
  drawn (a short delay), and `keepSpotInView` keeps the same spot under the pointer / at the top. The words layer is
  pdf.js's `TextLayer`, built once per page at scale 1 and resized by the `--scale-factor` CSS variable.
- Everything outside `src/app` and `src/pdf` is pure and tested in Node (`tests/*.test.ts`). `scripts/smoke-test.mjs`
  builds a small PDF itself, drops it on the built app in headless Chromium and checks drawing, words, page moves, zoom,
  save, help and dark mode; it fails on any console error. `?smoke` exposes the store as `window.jurapdfStore`.
- Printing (`src/app/printing.ts`): chosen pages drawn at 150 dpi, the print watermark (`src/model/printMark.ts`:
  "UNCONTROLLED DOCUMENT" and/or the "Text" box's words, printed as typed, see-through red, corner to corner) drawn on, then shown as pictures in
  a hidden iframe with one `@page` size per page and printed. The owner asked for these two options on the Print
  window (the box is called "Text" so it can hold a work order number or anything else); keep that wording.
- Edits: each change makes a new version of the whole file (`applyChange` in `src/app/editing.ts` → `changePdf` in the
  store, which keeps up to 20 earlier versions for Undo/Redo, each with its own pdf.js document on one shared worker).
  `savedBytes` marks the version last opened or saved; anything else is "Unsaved changes". `openId` changes only when a
  new file is opened (the page view goes back to the top only then).
- Watermarks (`src/model/watermark.ts` pure layout, `src/pdf/watermark.ts` writing): positions are worked out "as
  shown" (y up, after the page's own turn) and turned into the page's space by `toPageSpace`; text is written with the
  14 standard fonts (WinAnsi letters only, explained kindly otherwise). In front: the page's own drawing is wrapped in
  q/Q first; behind: the watermark's stream goes first. Locked (encrypted) PDFs are turned away with `LockedPdf`.
  `tests/watermark.test.ts` reads the result back with pdf.js (legacy build) to check where the words landed.
- App icons: edit `public/favicon.svg`, then `npm run icons` (set `CHROMIUM_PATH` if Playwright's own browser isn't
  installed).
- Versions: `package.json` holds the version (shown as e.g. "v0.1" in the top bar); add each version's notes to the top
  of `CHANGELOG.md` in plain English.
