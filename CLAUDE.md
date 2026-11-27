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
  after) uses `pdf-lib` (MIT, pinned), only in `src/pdf/`. Reading words in pictures uses `tesseract.js` 5.1.1 with
  `@tesseract.js-data/eng` (Apache 2.0, pinned; Kevin chose it), only in `src/pdf/ocr.ts`, loaded on first use. No other runtime
  dependencies, no CDNs: everything works offline.
- pdf.js's character maps and standard fonts are served from `node_modules` in dev and copied to `dist/pdfjs/` by the
  plugin in `vite.config.ts`. The worker comes from `virtual:pdfjs-worker-url` (`pdfjsWorker` in vite.config.ts): pdf.js's
  worker with JPGs carrying EXIF sent to pdf.js's own decoder, so `isImageDecoderSupported: true` (the browser unpacks
  other JPGs, ~10× quicker) can't turn photos; the build fails if the patched spot moves. The smoke test checks it.
- Units: page sizes are PDF points (72 to the inch), as pdf.js gives them (already turned for rotated pages). At 100%
  a page shows at real size: `CSS_PER_PT` = 96 / 72 CSS pixels per point (`src/model/zoom.ts`).
- The page view (`src/app/PageView.tsx`) lays every page out from `layoutPages` (pure) but only puts pages within 2.5
  windows on the page (`pagesInView`, found by halving), and only draws those within 1.5 (IntersectionObserver), letting
  far ones go. The page list does the same (`thumbLayout`, absolutely placed pictures). Speed (`npm run bench`, a
  2,000-page PDF): edits keep the pdf-lib document they saved (`saveEdited`/`loadForEditing` in src/pdf/watermark.ts,
  keyed by the saved bytes; pdf-lib's page list is refreshed as removePage leaves it stale), load and save in one go,
  and `keptSizes` gives the new sizes; a newly opened PDF is primed in the background (`primeForEditing`), or for
  more than 300 pages read with pdf-lib for its sizes (`sizesNow`). On a zoom change the old canvas is stretched until the new one is
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
- One page at a time (`onePage` in the store, remembered in localStorage `jurapdf.onePage`): PageView lays out only
  the page being read (fitted on its own, zoom "page"); the wheel flips pages through `wheelFlip` (zoom.ts) once a
  zoomed-in page can't scroll further (`wheelResting`: a glide is let go by after a flip, a fresh flick after a pause isn't), the pages
  ahead are drawn early (`pagesAhead` in zoom.ts: three on in the flick direction, one back; `drawAhead` in `src/app/pageCanvases.ts`, which keeps the last 8 drawings per version for any slot), and App's shortcuts flip with ↑/↓/Page Up/Page Down.
- Pages (`src/model/pages.ts` pure: picking and new orders; `src/pdf/pages.ts` writing): the page buttons in the
  ViewBar (`src/app/pageActions.ts`) work on the picked pages (`selected` in the store, cleared by every change, plain
  click = just go to the page) or else the page being read. Thumbnails are drag sources and drop targets for moving.
- Bookmarks (`src/model/bookmarks.ts` pure tree changes by path; `src/pdf/bookmarks.ts` reads them from a pdf.js
  document it's given and writes the whole outline with pdf-lib): the side panel (`SidePanel.tsx`, `sidePane` in the
  store, remembered in localStorage `jurapdf.sidePane`) has Pages and Bookmarks tabs. Its width (`sideWidth` per pane, localStorage `jurapdf.sideWidth`, rules in
  `src/model/sidePanel.ts`) is dragged by its right edge; thumbnails are drawn at `thumbWidthFor` once a drag pauses. `bookmarkActions.ts` keeps each
  version's tree (with folding) in a WeakMap by pdf.js document; every change writes a new version (one undo step).
  pdf-lib keeps page objects when pages move, so bookmarks follow them; ones to deleted pages show as going nowhere.
- Adding words and pictures (`src/model/additions.ts` pure: positions in points "as shown" from the top-left, line
  starts using `BASELINE` per font so the PDF words land where the screen font showed them; `src/pdf/additions.ts`
  writes them through `toPageSpace`, in front, wrapped like a watermark): `addActions.ts` runs placing (`placing` in
  the store: the next click on a page) and the `draft` (`DraftBox.tsx`, drawn inside the page at `cssScale`), Done
  writes one undo step. Live with Claude is busy while either is open. Claude tools: add_words, add_picture, add_shape (with fill and see_through), add_form_box. Shapes (`ShapeItem`:
  highlight, box, oval, line, arrow from (x1,y1) to (x2,y2); `addShape`, a highlight see-through with Multiply) are drawn by
  dragging on the page (PageView's pointerdown while `placing` is a shape) and changed in `ShapeDraft.tsx` (an SVG over the page). Words picked with the mouse get `PickedWordsBar` (Highlight, Copy):
  `pickedWordBoxes` reads the selection's boxes from the words layers, `highlightsFor` joins them per line, `addShapes` writes them as one step.
- Everything JuraPDF adds stays changeable (v0.8, `src/pdf/items.ts`): `addItems` draws each addition between
  `/JuraPDF<id> BMC … EMC` and remembers it (`Kept`: id, item, box) as JSON in the page's `/JuraPDFItems`; `changeItem`
  cuts the marked span out (`removeMarked`) and draws it again on top (pictures reuse their image by name). `keptIn`
  reads them per version (WeakMap by bytes, filled by `noteKept` after each write); `keptAt`/`hits` (model) pick one by a
  click: a plain click on the page (`clickPage`) or the pencil opens it as a draft with `id`, and `Underneath`
  (DraftBox) shows the page without it (`pageWithout`, a one-page copy). Drafts: `markDraft`/`undoDraft` (Ctrl+Z inside
  a draft), `nudgeDraft`, `duplicateDraft`, `deleteDraft`; a click away from a draft is Done; after a write the draft stays
  on show until the page is redrawn (`landed`). `arrange` doesn't wrap a page it already wrapped (per-PDF sets), so
  nesting stays shallow. Shapes have `fill` and `seeThrough`; `InkItem` is the pen (`InkDraft.tsx`, `thinStroke`).
- Form boxes (v0.9, `FieldItem` kind "field": text / tick / choice; `FieldDraft.tsx`, `startField`/`fieldDragTo` in addActions.ts,
  key F): written as real AcroForm fields by pdf-lib (`addField` in src/pdf/additions.ts, grey border, white inside), remembered
  in `/JuraPDFItems` like other additions but found by field name, not by a marked span: `removeField` takes the widgets off
  every page and then the field; `pageWithout` drops the widgets (`dropWidgets`). A plain click on one fills it in; the pencil changes it.
- Filling in forms (v0.10): `FormLayer.tsx` (in each PageSlot while near) lays an input / textarea / tick button / select over each
  box `formBoxes` (pdfjs.ts → `formBoxesFrom`, src/model/forms.ts) finds with pdf.js, tinted blue, its words see-through unless focused
  or just typed (the canvas draws the PDF's own appearance). Keys are name + count so focus survives each new version. Leaving a box
  → `fillIn` (`src/app/formActions.ts`, one at a time) → `fillForm` (`src/pdf/forms.ts`, pdf-lib; round buttons may be given by their
  "on" name as pdf.js knows them; several-line boxes get a size that fits, `fitLines`; if pdf-lib can't draw a box, NeedAppearances).
  `clearForm` / `flattenForm` (ViewBar eraser and padlock, shown when `hasForm`). Claude: read_form, fill_form (`answerFor`).
- Headers, footers and page numbers (v0.11, `HeadersDialog.tsx`, ViewBar button "Headers and footers"; `src/model/headers.ts`
  pure: six `SLOTS`, codes {page} {pages} {date} {file}, `startAt`, `digits` for Bates numbers, `linesFor`; `src/pdf/headers.ts`):
  drawn between `/JuraPDFHeaders BMC … EMC` (taken off with `removeMarked(page, tag)` before writing again, or by
  `removeHeaders`), settings remembered as JSON in the catalog's `/JuraPDFHeaders` (`headersIn`). Claude: add_headers.
- Black out / redaction (v0.12, `src/app/redactActions.ts`, `MarksLayer.tsx`, `RedactBar.tsx`, key B, `placing` {kind: "redact"},
  `marks`/`markDraft` in the store, cleared by every change; `src/model/redact.ts` pure; `src/pdf/redact.ts` `blackOut`): each
  marked page is drawn by pdf.js at 200 dpi without annotations (`pageBlackedOut`), black boxes painted on, and the page's
  Resources and Contents replaced by that JPG (placed via `toPageSpace`, turn kept); its level words outside the marks
  (`wordsOutside`, letter by letter) go back invisibly (`writeHiddenWords`); annotations under a mark go, and form fields with
  them. Marks come from dragging, `markPicked` (picked words) or `markFound` (search hits → `pageTextBoxes` → `lettersBox`).
  Browser only (needs a canvas), so Claude has no black-out tool yet.
- Signatures (v0.13, `SignDialog.tsx`, key S, ViewBar "Sign"; `src/model/signature.ts` pure: `inkBounds`, `clearPaper`, `placingSize`,
  kept list in localStorage `jurapdf.signatures` as PNG data links): the PNG (cut to its ink) is placed through `placePicture`
  (addActions) as a ChosenPicture named "Signature"; the PictureItem gets `signature: true` (Undo label "sign page N").
- Sticky notes (v0.14, `src/model/notes.ts` pure: `withReplies` joins IRT replies onto the top note, `readPdfDate`/`pdfDate`,
  `NOTE_SIZE` 22 as pdf.js draws them; `src/pdf/notes.ts` pdf-lib: `listNotes` (any reader's /Text notes, id = object number
  "12R", place from the Rect's top-left via `fromPageSpace`, the icon stays upright), `addNote`, `changeNote`, `removeNote`
  (with replies and /Popup windows)): `noteActions.ts` (`notesIn` per version via `peekForReading`, `note` in the store is the
  open one, `placing` {kind: "note"}, key N), `NotesLayer.tsx` (icons, drag to move, `NoteWindow`; a click away saves via
  `whileOpen`), `NotesList.tsx` (side panel tab "notes"). Claude: read_notes, add_note, delete_note.
- Changed words keep the PDF's own font (`src/pdf/fonts.ts` `pageFont`: simple fonts by ToUnicode or WinAnsi and their
  Widths, Type0 Identity-H by ToUnicode and W; `src/model/fontCodes.ts` pure), found by the name pdf.js gives
  (`RunFont` in `wordRuns`, via `page.commonObjs`); typed in the font pdf.js loaded into the browser (`own.screen`);
  when a letter's missing the nearest built-in font is used (`nearestFont`, 12 fonts incl. slanted). Colours come
  from the drawing (`coloursIn`: paper = commonest colour, ink = furthest from it).
- Changing what's on a page (pencil, `placing` {kind: "change"}, `startChanging`/`pickToChange` in addActions.ts): a click picks a
  run of words (`wordRuns` in pdfjs.ts; draft = words with `cover`, written by `addWords` as a white box then the words) or a
  picture (`src/pdf/pictures.ts`: `parseContent` (src/model/contentStream.ts) walks the page's instructions tracking q/Q/cm to find
  each image `Do`; `changePicture` replaces just that command with `q M cm /Name Do Q` (`moveMatrix`/`placeMatrix` in
  src/model/pictures.ts) or nothing; draft kind "existing" with a canvas-cropped preview). Pictures inside forms aren't found.
- Bring in and save out: Bring in (`insertFromFile` → `bringIn` in pageActions.ts, `pickFiles` in fileActions.ts) takes PDFs and
  PNG/JPG (`insertPictures` in src/pdf/pages.ts: one page each, sized like its neighbours, turned to suit). `exportActions.ts`:
  `savePagesAsPictures` (`pagePicture` in pdfjs.ts at `PICTURE_DPI` 200; several pages in a zip from `makeZip`, src/model/zip.ts,
  stored not squeezed) and `saveWordsAsText` (`pageText`/`documentText`, src/model/textOut.ts). Saving goes through `writeFile`.
- Reading words in pictures (`src/app/ocrActions.ts`, button "Read words in pictures"): `pageForReading` (pdfjs.ts) draws the page at
  300 dpi with pale colours turned white (`inkOnly`) and lists the page's own level words; `readPicture` (src/pdf/ocr.ts) runs
  Tesseract from `ocr/` (worker, core, eng.traineddata.gz, copied by `ocrFiles` in vite.config.ts); `wordsToAdd` (src/model/ocr.ts)
  keeps sure words not already on the page; `addHiddenWords` writes them invisibly (render mode 3, squeezed to the word's width).
- Find words (`SearchBar.tsx`, `searchActions.ts`, `SearchHits.tsx`; `search` in the store, null when closed): `src/model/search.ts`
  (pure) folds each page's pdf.js text bits (capitals and accents unless Match capitals, curly quotes, dashes, spaces, line
  ends) keeping which bit and letters each folded letter came from, so a hit is a list of pieces (bit, from, to). The words
  layer has one span per bit in the same order (`spans()` from `drawTextLayer`), so `SearchHits` colours them in from
  Range rects, kept as shares of the page so they follow the zoom. `lookThrough` reads pages from the one being read on, then
  from the start, 24 at a time, keeping each version's words (WeakMap by pdf.js document); it runs again by itself whenever
  `pdf.doc` changes. `showHit` scrolls to a hit already drawn, or else goes to its page and sets `scrollTo` for SearchHits.
- JuraPDF for Claude (`src/mcp/`, `src/live/`, `claude-extension/manifest.json`): JuraDAW's extension and live link
  (which are JuraCAD's) with the names changed, so a fix in one belongs in the others. Ports **47655–47664** (JuraCAD
  47615–47624, JuraDAW 47635–47644), path `/jurapdf-live`, sub-protocol `jurapdf-live.1`, `JURAPDF_LIVE_DEV=1` lets in
  pages served on this computer (the smoke test). The PDF travels as base64 (`src/model/base64.ts`) with its file name
  (`name` on hello/doc/change); `MAX_MESSAGE_BYTES` 150 MB. The session holds a `PdfDoc` {name, bytes}, Claude's own
  undo list and a `label` per change ("turned page 2") that becomes the tab's undo step ("Claude: turned page 2",
  `describeChange`). `tools.ts`: format_guide, live_status, describe_pdf, read_words, list_pdfs, open_pdf, new_pdf,
  save_pdf, add_watermark, add_words, add_picture, add_shape, add_form_box, read_form, fill_form, add_headers, read_notes, add_note, delete_note, turn_pages, delete_pages, move_pages, add_blank_pages, bring_in_pdf, save_pages_as_pdf, undo —
  page numbers from 1 (`pagesOf`), changes through `src/pdf/pages.ts` and `watermark.ts`. `reading.ts` reads words with
  pdf.js's legacy build in Node (the worker imported into the bundle as `globalThis.pdfjsWorker`). `quietStdout.ts` is
  imported first by server.ts so nothing pdf.js prints reaches stdout. In the app: `LiveButton` in the TopBar (with a
  PDF open), `liveLink.ts` (busy while the Watermark/Print/password window is open), `applyClaudeChange` in editing.ts
  (async: the client handles one message at a time). CI builds, packs (`dist/jurapdf-claude.mcpb`, linked from Help)
  and checks it (`scripts/check-claude-extension.mjs`); the smoke test drives it live. Tests: liveProtocol,
  liveRelay, liveLink, mcpTools.
- App icons: edit `public/favicon.svg`, then `npm run icons` (set `CHROMIUM_PATH` if Playwright's own browser isn't
  installed).
- Versions: `package.json` holds the version (shown as e.g. "v0.1" in the top bar); add each version's notes to the top
  of `CHANGELOG.md` in plain English (`## vX.Y — title` then `- ` lines). Clicking the version opens `WhatsNewDialog.tsx`
  (JuraCAD's), which reads CHANGELOG.md into the app (`?raw`, parsed by `src/model/changelog.ts`); a dot shows until
  this version's notes are seen (localStorage `jurapdf.seenVersion`). `tests/changelog.test.ts` checks this version has notes.
