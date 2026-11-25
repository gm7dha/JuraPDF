# JuraPDF versions

Each version is a safe point to go back to. To roll back, ask for "go back to vX.Y": the change is made as a pull
request that undoes everything after that point. Your PDFs are ordinary files and aren't touched.

The point in the history for each version is the commit shown (see https://github.com/gm7dha/JuraPDF/commits/main).

## v0.6.2 — Highlights and shapes

- **Highlight words**: the marker button, then drag across the words. They're coloured in with see-through yellow
  (or any colour you pick), so they still show and print.
- **Draw a box, oval, line or arrow** to point something out: pick it, drag on the page, then drag its round handles
  to change it and choose a colour and thickness. **Done** puts it on the page (one Undo step); Esc leaves it off.
- Claude can do the same with its new **add_shape**.
- Fixed: after Undo, the words of the version before could sometimes still be picked up when selecting text.

## v0.6.1 — Snappier

- **Long PDFs open, scroll and change much faster.** Timed with a 2,000-page PDF:
  - opening: 0.6 seconds, down from 1.6;
  - a change, such as turning a page: 0.3 seconds, down from 2.1;
  - Undo and Redo: under a twentieth of a second, down from a quarter;
  - zooming and scrolling no longer stutter.
- How: only the pages and page pictures near what you're looking at are made at all (not all 2,000); a change no
  longer reads the whole file again first, as the version just made is kept ready; files are written in one go;
  page sizes come from the change just made; and after a change or Undo, the pages are drawn straight away.

## v0.6 — Add words and pictures to pages

- **Add words** (the T button in the bar under the top bar): click on a page where the words should start and type.
  Choose the font, letter size and colour above the box; drag the ✥ handle to move it. Several lines are fine. Click
  **Done** (or Ctrl+Enter) to put them on the page, or Esc to leave them off. Handy for notes, a name and date, or
  "Approved".
- **Add a picture** (the picture button): choose a PNG or JPG (a signature, a stamp, a logo), click on a page where it
  should go, drag it to move it and drag its round corner to make it bigger or smaller (it keeps its shape). Then
  **Done**.
- Both are saved into the page like everything else, and Undo takes them back. They land the right way up on turned
  pages too.
- **Claude** can do the same: ask it to "write 'Checked by Kevin, 24 Nov' at the bottom of page 3" or "put
  signature.png on the last page" (pictures come from your JuraPDF folder).

## v0.5.2 — A wider or narrower side panel

- **Drag the right edge** of the panel on the left (Pages or Bookmarks) to make it wider or narrower. With Pages,
  the page pictures grow to fill it, so you can see more of each page. Double-click the edge to go back to the usual
  width. JuraPDF remembers the width you like, separately for Pages and Bookmarks.

## v0.5.1 — Bookmarks

- **Bookmarks** sit beside **Pages** in the panel on the left: click the **Bookmarks** tab. It lists the PDF's own
  chapters and sections (with any inside them, which you can fold away); click one to go to its page. The bookmark
  for the page you're reading is marked as you move through the PDF.
- **Add your own**: go to a page and press **+**, then type a name. You can also rename a bookmark (double-click it),
  make it go to the page you're on, delete it, move it up or down, or put it inside the one above (and take it out
  again). Each change can be undone, and the bookmarks are saved in the PDF, so other PDF readers show them too.
- JuraPDF remembers whether you last had Pages or Bookmarks showing.

## v0.5 — JuraPDF with Claude

- **An extension for the Claude desktop app** (Help › Use JuraPDF with Claude: download it, double-click, Install).
  Then ask Claude in plain English, for example "put a DRAFT watermark on every page", "join Report and Appendix",
  "turn the landscape pages the right way round", "save pages 3 to 5 as their own PDF" or "what does page 2 say?".
  Claude can read the words on the pages, add watermarks (words or a picture), turn, move, delete and add pages,
  bring in the pages of another PDF, save some pages as a new PDF, and undo its own changes.
- It works on PDFs in your **JuraPDF folder** (Documents › JuraPDF, or another folder you choose in the extension's
  settings). It can't read or write anywhere else.
- **Live with Claude**: click **Connect to Claude** in the top bar and Claude works on the PDF you have open, while you
  watch. Each of its changes is one step you can undo, and nothing is saved to your file until you click Save. Works
  in Chrome, Edge and Firefox; in Safari a small link window opens and must stay open. The link stays on your
  computer and only the JuraPDF website can use it.

## v0.4.1 — One page at a time

- **One page at a time** (the new button beside the zoom buttons): the whole page fits in the window, and scrolling,
  the ↑ ↓ arrow keys or Page Up / Page Down flip to the next or previous page. If you zoom in, the page scrolls first
  and then flips at its top or bottom. Click the button again to see the pages one under another. JuraPDF remembers
  which way you like.

## v0.4 — Pages

- **Pick pages** in the page list down the left: Ctrl-click (⌘-click on a Mac) to pick several, or click one and
  Shift-click another to pick all those in between. Esc stops picking.
- **Page buttons** in the bar at the top. They work on the picked pages, or the page you're on if none are picked:
  - **Turn** a quarter turn left or right.
  - **Move** one place earlier or later. Or just **drag** pages up and down the page list.
  - **Delete** (or press the Delete key). A PDF always keeps at least one page.
  - **Add a blank page**, the same size and way round as the page before it.
  - **Bring in pages from another PDF**: all its pages go in after the page you're on. This is also how to join PDFs.
  - **Save pages as a new PDF**: the picked pages become a PDF of their own (the one you have open doesn't change).
    This is also how to split a PDF up.
- Every change can be undone and redone.

## v0.3 — Watermarks saved into the PDF, and Undo

- **Watermark** (the new button in the top bar): words or a picture (PNG or JPG, such as a logo), saved into the
  pages so they're there wherever the PDF is opened or printed.
  - Words: any letters from six built-in styles (Helvetica, Times or Courier, plain or bold), the colour (red, grey,
    blue, black or any other), and a size that fills the page or one you choose.
  - Pictures: as wide as you like, from 5% to the whole width of the page.
  - Angle: corner to corner, level, or any angle. Where: the middle, the top, the bottom, a corner, or repeated all over
    the page.
  - How see-through it is, and whether it goes in front of or behind what's on the page.
  - Which pages: all, odd, even, or the ones you choose (e.g. 1-3, 5).
  - A preview shows the page with the watermark exactly as it will be. Your choices are remembered for next time.
- **Undo and Redo** (the arrows in the top bar, Ctrl + Z and Ctrl + Y): take a watermark off again, or put it back.
- The top bar says **Unsaved changes** until you Save, and JuraPDF asks before you close it or open another PDF and lose
  them.

## v0.2.1 — The Work Order box is now "Text"

- The Print window's second watermark box is now called **Text**, so it can hold anything: a work order number
  ("Work Order W245354"), a name, a date. It's printed exactly as you type it, under "UNCONTROLLED DOCUMENT".

## v0.2 — Print, with an "Uncontrolled Document" and Work Order watermark

- **Print** (the Print button, or Ctrl + P): print every page, the page you're on, or the pages you choose (e.g. 1-3, 5).
  Each page prints on paper of its own size, so landscape pages print landscape.
- **Watermark the printout**: tick **Uncontrolled Document** and/or type a **Work Order** number (e.g. W245354). They're
  written large in see-through red, corner to corner across every printed page, the work order just under
  "UNCONTROLLED DOCUMENT". A preview shows the page as it will print. Only the printout is marked: your PDF isn't
  changed.
- The tick is remembered for next time, and the work order is kept until you close JuraPDF, so reprints are quick.

## v0.1 — Open and read PDFs

- **Open a PDF** with the Open button, or drag it onto the window. Password-protected PDFs ask for the password.
- **Pages** one under another, drawn sharp at any zoom, with a **page list** of thumbnails down the left.
- **Go to a page**: click its thumbnail, type its number, or use the arrows, ← / → and Home / End.
- **Zoom**: − and +, type a zoom, Fit to width, Whole page, or 100% (real size). Ctrl + scroll or a pinch zooms
  towards the pointer.
- **Select and copy words**, and find them with Ctrl + F.
- **Save** the PDF back to your computer.
- **Install** as an app (works offline, opens PDFs you double-click), **dark mode**, and Help (press ?).
