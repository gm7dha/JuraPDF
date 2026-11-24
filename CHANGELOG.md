# JuraPDF versions

Each version is a safe point to go back to. To roll back, ask for "go back to vX.Y": the change is made as a pull
request that undoes everything after that point. Your PDFs are ordinary files and aren't touched.

The point in the history for each version is the commit shown (see https://github.com/gm7dha/JuraPDF/commits/main).

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
