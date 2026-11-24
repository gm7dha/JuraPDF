# JuraPDF versions

Each version is a safe point to go back to. To roll back, ask for "go back to vX.Y": the change is made as a pull
request that undoes everything after that point. Your PDFs are ordinary files and aren't touched.

The point in the history for each version is the commit shown (see https://github.com/gm7dha/JuraPDF/commits/main).

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
