# JuraPDF versions

Each version is a safe point to go back to. To roll back, ask for "go back to vX.Y": the change is made as a pull
request that undoes everything after that point. Your PDFs are ordinary files and aren't touched.

The point in the history for each version is the commit shown (see https://github.com/gm7dha/JuraPDF/commits/main).

## v0.11 — Headers, footers and page numbers

- **Number the pages,** or put words along the top and bottom of every page, with the new button that looks like a
  numbered page. There are six spots: top left, middle and right, and the same along the bottom.
- **Fill-ins that change on each page:** the page number, the number of pages, today's date and the file's name. For
  example "Page {page} of {pages}" shows as "Page 3 of 12".
- **Quick starts** for the usual jobs: "Page 1 of 9", plain numbers, numbers at the right, a name and date header, and
  **Bates numbers** (a code plus a number with zeros in front, like ABC000123, as used for legal and work files).
- **Choose the pages** (for example 2-10, to leave a cover page out), the number to start from, the letters, size,
  colour and how far from the edge. A preview shows the page as it will look.
- **Change them or take them off later:** opening the window again shows the settings they were added with. Adding
  them again replaces the old ones rather than writing over them, and "Take them off" removes them.
- **Claude can add them too** (add_headers), for example "number the pages, leaving out the cover".

## v0.10 — Fill in forms

- **Fill in any PDF form right in JuraPDF.** Form boxes are tinted light blue, as in other PDF readers. Click a box to
  type in it, tick a tick box, pick a round button, or choose from a list. Tab goes on to the next box, and leaving a
  box writes the answer into the PDF, so Save keeps it and Acrobat, Preview or Tungsten show it too.
- **Each answer is one step in Undo,** named after its box ("Undo fill in “Name”"), so a wrong answer is easy to take back.
- **Empty the form** (the new eraser button) takes out every answer at once.
- **Make the answers part of the pages** (the new padlock button): what's filled in stays exactly where it is, but the
  form boxes go, so nobody can change the answers afterwards. Handy before sending a finished form on. Undo brings the
  boxes back.
- These two buttons only show when the PDF has a form.
- **Claude can fill in forms too:** read_form lists a PDF's form boxes and what's in them, and fill_form fills them in,
  for example "fill in the work order number and tick Approved".
- Form boxes you added yourself now fill in with a click like any other; to move or change one, use the pencil.
- Boxes that take several lines no longer show the words far too big.

## v0.9 — Fillable forms

- **Add form boxes that anyone can fill in.** The new form button (or the F key) adds a text box, a tick box or a
  choice list (a drop-down to pick from) wherever you drag on the page. They're real form boxes, so Acrobat, Preview,
  Tungsten and other PDF readers let people type into them, tick them or pick a choice, and save what they filled in.
- **Name each box** (for example "Work order"), so the answers are easy to tell apart. Text boxes can hold several
  lines, and their letter size can be set or left to fit the box.
- **Change them later** just like everything else you add: click one to move it, make it bigger, rename it, copy it
  or delete it. Undo works as usual.
- **Claude can add them too** (add_form_box), for example "add a text box for the work order number at the top".
- The tool buttons fit better on smaller screens.

## v0.8 — Better editing: change anything you've added

- **Change things after you've added them.** Words, pictures, boxes, ovals, lines, arrows, highlights and drawings
  you've put on a page stay changeable, even after saving and opening the PDF again. Just click one (the pointer
  turns into a hand over it) to move it, make it bigger or smaller, change its colour or words, copy it, or delete it.
- **Changing words keeps their look.** When you fix words already in a PDF with the pencil, they're now written in
  the PDF's own font, at the same size and in the same colour, so they match the words around them. If the PDF's font
  is missing a letter you type, JuraPDF says so and uses the closest built-in font instead.
- **Fill in boxes and ovals,** in any colour, and make shapes and drawings see-through (a quarter, half or three
  quarters).
- **Changes show straight away.** Picking a colour, a fill or a thickness changes the shape on the page at once,
  and a quick row of colours to click saves opening the colour picker. Boxes have a handle on every corner.
- **Draw freehand** with the new pen button (or press P): drag on a page as many times as you like, then Done.
- **Underline or cross out words:** pick words with the mouse, then use the new buttons beside Highlight.
- **Undo while you're placing something:** Ctrl+Z (⌘Z on a Mac) takes back the last move or change to the thing
  you're placing, before it goes on the page. Undo and Redo at the top still take back whole changes.
- **Keyboard shortcuts for the tools:** T words, H highlight, R box, O oval, L line, A arrow, P pen, E change what's
  on a page. While something is picked: arrow keys nudge it (Shift for bigger steps), Delete removes it, Ctrl+D (⌘D)
  copies it, Enter puts it on the page and Esc leaves it as it was. Clicking elsewhere on the page puts it on too.
- **More fonts:** slanted (italic) Helvetica, Times and Courier, for words and watermarks.
- Claude can fill in boxes and ovals and make shapes see-through too.

## v0.7.3 — What's new, in a window

- **Version notes in a window.** Clicking the version (e.g. "v0.7.3") at the top now opens a window inside
  JuraPDF listing what changed in this version, with the earlier versions below (click one to open it), the same
  way JuraCAD does, instead of taking you to a web page. It works offline too.
- **A dot for new versions.** After an update, a small red dot on the version shows there's something new to read;
  it goes once you've looked. Help has a "what's new" link as well.

## v0.7.2 — Find words

- **A search bar.** The magnifying glass beside the page number (or Ctrl+F, ⌘F on a Mac) opens a little bar at
  the top right of the pages. Type some words and every place they appear in the whole PDF is coloured in yellow,
  with the one you're on in orange, and the bar says how many there are ("3 of 12").
- **Next and previous.** Enter (or the down arrow on the bar) goes to the next place, Shift+Enter (or the up
  arrow) to the one before, going round from the last to the first. It jumps to the right page, even far away,
  and in one-page-at-a-time view too. F3 and Ctrl+G work as well. Esc closes the bar and takes the colouring off.
- **Forgiving.** Capitals, accents, curly quotes and extra spaces don't matter, and words split over two lines are
  still found. Turn on **Match capitals** (the Aa button) to find only words written exactly the same.
- **Always up to date.** After any change (adding words, bringing in pages, Undo, reading words in pictures) the
  open search looks again by itself.
- **Scans and photos.** Pages with no words to find (scans, photos, blank pages) are pointed out, with a button to
  read the words in their pictures; once read, they're found too.
- **Quick on long PDFs.** It looks from the page you're on first, so nearby places show straight away, and keeps
  each page's words once read, so changing the search is almost instant (a 2,000-page PDF: about a fifth of a
  second).

## v0.7.1 — Quicker flicking through scanned pages

- **Scanned pages show much sooner.** Pages that are photos or scans used to take up to half a second each the first
  time they were shown, while JuraPDF unpacked the picture. In Chrome and Edge it now lets the browser unpack them,
  about ten times quicker (around 50 ms a page). Photos that carry a "which way up" note are still unpacked the
  careful way so they never come out turned.
- **One page at a time reads ahead.** It now gets the next three pages ready in the direction you're flicking (and
  one the other way), so flicking quickly through a long scan keeps up.

## v0.7 — Bring in and save out

- **Pictures as new pages.** The "bring in" button now takes PNG and JPG pictures as well as PDFs (several at once
  if you like). Each picture becomes a page of its own, the size of the pages around it, turned to suit the
  picture's shape, with the picture filling it.
- **Save pages as pictures.** A new button saves the page you're reading (or the pages you've picked) as PNG
  pictures, sharp enough to print. Several pages come together in one zip file.
- **Save the words as text.** A new button saves every word in the PDF as a plain text file, page by page. For a
  scan, use Read words in pictures first.

## v0.6.5 — Change what's already on a page

- **Change what's on a page** (the pencil button, first in the "add" group): then click on the page.
  - **On a picture:** drag it to move it, or drag its round corner to make it bigger or smaller (it keeps its
    shape). The little buttons swap it for another picture (PNG or JPG) in the same place, or delete it.
  - **On some words:** they open for typing, already filled in, in the nearest matching letters and size. Change
    them and press Done: the old words are covered with white and the new ones written in their place. Best for short
    fixes (a date, a name, a typo), as a PDF doesn't move the rest of the line along. The old words stay hidden
    underneath (so they can still turn up when searching).
- Each change is one Undo step.

## v0.6.4 — Read the words in pictures

- **Read words in pictures** (the new button after the arrow): JuraPDF finds the words in the pictures on the page
  you're reading (or the pages you've picked), such as a scanned letter or a photo of a receipt, and writes them in
  invisibly, exactly over where they show. Then they can be picked, copied, highlighted and found with Ctrl+F like
  any other words. One Undo step takes them away again.
- It uses Tesseract, a free text reader that runs on your computer: nothing is sent anywhere. The first time, its
  files (about 7 MB) are fetched; after that it works offline. English letters only for now.

## v0.6.3 — Quicker page flips, highlight picked words

- **One page at a time flips straight away.** The pages either side are drawn ahead while you read, so the next
  one is already there; pages just looked at are kept for a moment too. A quick flick of the mouse wheel now flips
  again at once, while a trackpad's glide still only turns one page.
- **Pick words with the mouse, then Highlight.** A small bar appears by the words you've picked: Highlight colours
  them in (see-through, line by line, across pages too, as one Undo step), and Copy copies them.

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
