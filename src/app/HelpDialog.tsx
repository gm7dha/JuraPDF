import { useRef, useState } from "react";

import { useStore } from "../model/store";
import { APP_VERSION, SHORT_VERSION } from "../version";
import { eggClick } from "./easterEgg";
import { Modal } from "./Modal";
import { detectPlatform, helpRows, type Platform } from "./platform";

export function HelpDialog() {
  const openDialog = useStore((s) => s.openDialog);
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform());
  const rows = helpRows(platform);
  // A little surprise (as in JuraCAD and JuraCUT): the Windows / Mac buttons clicked 10 times within 5 seconds.
  const clicks = useRef<number[]>([]);
  const [egg, setEgg] = useState(false);
  const choose = (p: Platform) => {
    setPlatform(p);
    const r = eggClick(clicks.current, performance.now());
    clicks.current = r.recent;
    if (r.found) setEgg(true);
  };
  return (
    <Modal title="Help and shortcuts" onClose={() => openDialog(null)} width={620}>
      <p>
        JuraPDF shows and edits PDF files, right here in your browser. <strong>Open</strong> a PDF (or drag one onto the window), move round it with the page list on the left, and{" "}
        <strong>Save</strong> it back to your computer. Your files never leave your computer.
      </p>
      <p>
        <strong>Print</strong> can write <strong>UNCONTROLLED DOCUMENT</strong> and words of your own (such as a work order number) across every printed page. Only the printout is
        marked; your PDF isn't changed.
      </p>
      <p>
        <strong>Watermark</strong> saves words or a picture into the pages. The page buttons in the bar under the top bar turn, move, delete and add pages, bring in pages from another PDF, and
        save some pages as a new PDF. They work on the pages picked in the page list, or else the page you're on. <strong>Undo</strong> takes back any change.
      </p>
      <p>
        <strong>Find words</strong> (the magnifying glass, or Ctrl+F): type some words and every place they're in the PDF is coloured in, with how many there are. Enter goes to the
        next place (Shift+Enter the one before), even on pages far away. Capitals and accents don't matter unless you turn on <strong>Match capitals</strong> (the Aa button). Pages
        that are scans or photos have no words to find until you use <strong>Read words in pictures</strong>; the search bar offers to do that for you.
      </p>
      <p>
        <strong>Bookmarks</strong> (the tab beside <strong>Pages</strong> on the left) lists the PDF's chapters and sections: click one to go there. <strong>+</strong> bookmarks the page
        you're on; you can rename (double-click), delete, move bookmarks up and down, put one inside another, and fold them away. They're saved in the PDF, so other PDF readers show them too. Drag the panel's right edge to make it wider or narrower.
      </p>
      <p>
        <strong>Add words</strong> (the T button) and <strong>Add a picture</strong> (the picture button): click on a page where it should go, then type, or drag the picture and its round corner to
        place and size it. <strong>Done</strong> puts it on the page; Esc leaves it off.
      </p>
      <p>
        <strong>Highlight</strong> (the marker button): drag across words to colour them in, see-through so they still show. The <strong>box</strong>, <strong>oval</strong>,{" "}
        <strong>line</strong> and <strong>arrow</strong> buttons draw by dragging on a page (an arrow points to where you let go). Drag the round handles to change it, pick a colour,
        a fill colour for the inside, a thickness and how see-through, then <strong>Done</strong>. The <strong>pen</strong> draws freehand: drag as many times as you like, then
        Done. Or pick words with the mouse, and press <strong>Highlight</strong>, <strong>underline</strong> or <strong>cross out</strong> on the little bar by them.
      </p>
      <p>
        Everything you add stays changeable, even after saving: <strong>click it</strong> to move it, size it, change its colour or words, copy it or delete it. Each tool has a
        one-letter shortcut (see below).
      </p>
      <p>
        <strong>Bring in</strong> takes other PDFs, or PNG and JPG pictures (each becomes a page). <strong>Save pages as pictures</strong> saves the pages as PNG pictures (several in
        a zip file), and <strong>Save the words as text</strong> saves every word in the PDF as a text file.
      </p>
      <p>
        <strong>Change what's on a page</strong> (the pencil): click a picture to move it, resize it, swap it or delete it, or click some words to retype them (the old ones are
        covered over, and the new ones are written in the PDF's own font, size and colour when it has the letters). Best for short fixes, as a PDF doesn't move the rest of the line along.
      </p>
      <p>
        <strong>Read words in pictures</strong> (the button after the arrow): finds the words in a scanned page or a photo, so they can be picked, copied, highlighted and found
        with Find words. It runs on your computer; the first time it fetches its reader (about 7 MB), then it works offline.
      </p>
      <p>
        <strong>Add a form box</strong> (F): drag on a page to add a text box, a tick box, a drop-down choice list, a list box, a round button or a date box that people can fill in with Acrobat,
        Preview or any other PDF reader. Give each one a name so the answers are easy to tell apart. Round buttons with the same set name go
        together (only one can be picked), and each new one joins the last set. A date box writes dates your chosen way and has a calendar. A list box shows every choice, and can let several be picked.
        Tick Must be filled in for boxes that can't be left empty: they show a red edge until they're filled in. To
        move or change one later, use the pencil.
      </p>
      <p>
        <strong>Fill in a form</strong>: the boxes of any PDF form are tinted blue. Click one to type in it, tick it or pick a choice; Tab goes to the next one, and each
        answer is one step you can undo. When a PDF has a form, two more buttons show: <strong>Empty the form</strong> (the eraser) and <strong>Make the answers part of the
        pages</strong> (the padlock), which keeps what's filled in but takes the boxes away so nobody can change the answers.
      </p>
      <p>
        <strong>Headers and footers</strong> (the numbered page button): page numbers, Bates numbers or words along the top and bottom of the pages. Type{" "}
        {"{page}"} for the page number, {"{pages}"} for the number of pages, {"{date}"} for today's date and {"{file}"} for the file's name, or use the buttons. Open it
        again to change them or take them off.
      </p>
      <p>
        <strong>Black out</strong> (B): drag over words or pictures to mark them, or mark picked words or everything Find words finds. Nothing changes until{" "}
        <strong>Black out for good</strong>: then what's under the black is removed from the PDF, so nobody can copy, find or uncover it. The page becomes a picture, but its
        other words can still be picked and found.
      </p>
      <p>
        <strong>Sign</strong> (S): draw your signature, type it in a handwriting style, or bring in a photo of it (the white paper is made see-through), then click
        where it goes. Signatures are kept on this computer to use again with one click.
      </p>
      <p>
        <strong>Stamp</strong> (K): APPROVED, RECEIVED, CONFIDENTIAL and more, or your own words, in green, blue, red or black, with your name and today's date under them if
        wanted. Click where it goes, then move it or size it like a picture. It stays changeable afterwards.
      </p>
      <p>
        <strong>Notes</strong> (N): click where a sticky note goes and type a comment. Click a note's icon to read or change it (its colour too), drag it to move it,
        or delete it. The <strong>Notes</strong> tab in the side panel lists every note, with any replies; Acrobat, Preview and other readers show them too.
      </p>
      <p>
        <strong>Make smaller</strong>: shrinks pictures that are bigger than the pages need and tidies away leftovers, for email or the web. Choose how small: “A little” keeps
        pictures sharp for printing; “As small as possible” makes them softer. The words stay as sharp as ever, and Undo brings back the original.
      </p>
      <p>
        <strong>Trim pages</strong> (C): drag a box round the part of a page to keep, choose this page or all of them, and click <strong>Trim</strong>. The edges
        outside are hidden, not thrown away: <strong>Show whole pages</strong> brings them back. Things you added stay where they were.
      </p>
      <p>
        <strong>Compare</strong> (two pages with arrows): pick another PDF, an older version say, and every word that differs is found. The <strong>Changes</strong> tab
        lists them; click one (or press F4 and Shift+F4) to see it on its page: new words in green, changed ones in amber, a red bar where words were taken out.{" "}
        <strong>Mark them on this PDF</strong> highlights them for good, with a red sticky note saying what was taken out or what it used to say.
      </p>
      <p className="muted">Coming next: recent files, and keeping your work in the browser between visits.</p>
      <div className="platform-row">
        <span className="muted small">Shortcuts shown for</span>
        <div className="segmented two" role="radiogroup" aria-label="Keyboard type">
          {(["windows", "mac"] as const).map((p) => (
            <button type="button" key={p} role="radio" aria-checked={platform === p} className={platform === p ? "selected" : ""} onClick={() => choose(p)}>
              {p === "mac" ? "Mac" : "Windows"}
            </button>
          ))}
        </div>
      </div>
      <h3 className="help-heading">Mouse and touch</h3>
      <table className="help-table">
        <tbody>
          {rows.mouse.map(([a, b]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="help-heading">Keys</h3>
      <table className="help-table">
        <tbody>
          {rows.keys.map(([a, b]) => (
            <tr key={a}>
              <td>
                <kbd>{a}</kbd>
              </td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="help-heading">Use JuraPDF with Claude</h3>
      <p className="small">
        Ask Claude, in the Claude desktop app, to do things with your PDFs in plain English. For example: "put a DRAFT watermark on every page", "join these two PDFs", "turn the
        landscape pages the right way round", "save pages 3 to 5 as their own PDF" or "what does page 2 say?".
      </p>
      <ol className="small help-steps">
        <li>
          <a href={`${import.meta.env.BASE_URL}jurapdf-claude.mcpb`} download="jurapdf-claude.mcpb">
            Download the JuraPDF extension for Claude
          </a>
          .
        </li>
        <li>Double-click the downloaded file (or drag it onto the Claude desktop app's window). Claude shows the install screen: click Install.</li>
        <li>
          Start a new chat in Claude. Claude works on PDFs in Documents › JuraPDF (you can choose another folder in the extension's settings), or live on the PDF open here (below).
        </li>
      </ol>
      <h3 className="help-heading">Live with Claude</h3>
      <p className="small">
        Let Claude work on the PDF you have open here while you watch. With the extension installed and the Claude app open, click <b>Connect to Claude</b> in the top bar (nothing
        connects until you do). The first time, your browser may ask whether JuraPDF can reach apps on this device: click Allow. A green <b>Live with Claude</b> badge shows while you're
        connected.
      </p>
      <ul className="small help-steps">
        <li>It works with every Claude chat that has JuraPDF, including chats you start after connecting (they're found within a few seconds).</li>
        <li>
          Each of Claude's changes is one step you can undo ({platform === "mac" ? "⌘Z" : "Ctrl+Z"}). Nothing is saved to your file until you click Save. If you both change something at
          the same moment, Claude's change is turned back and it tries again, so nothing is lost. Claude waits while the Watermark or Print window is open.
        </li>
        <li>
          Works in Chrome, Edge and Firefox. In Safari, Connect to Claude opens a small <b>JuraPDF ↔ Claude</b> window that passes messages along: allow the pop-up if Safari asks, and keep
          that window open while you work.
        </li>
        <li>The link stays on this computer: only the JuraPDF website can use it, and Claude only reads and saves files in your JuraPDF folder.</li>
      </ul>
      <p className="muted small">
        JuraPDF {SHORT_VERSION} ({APP_VERSION}):{" "}
        <button type="button" className="text-button inline-link" onClick={() => openDialog("whatsNew")}>
          what's new
        </button>
        . JuraPDF is free and open source (MIT):{" "}
        <a href="https://github.com/gm7dha/JuraPDF" target="_blank" rel="noreferrer">
          github.com/gm7dha/JuraPDF
        </a>
        . It draws pages with Mozilla's{" "}
        <a href="https://mozilla.github.io/pdf.js/" target="_blank" rel="noreferrer">
          pdf.js
        </a>{" "}
        (Apache 2.0). Its sister programs are{" "}
        <a href="https://gm7dha.github.io/JuraCAD/" target="_blank" rel="noreferrer">
          JuraCAD
        </a>
        ,{" "}
        <a href="https://gm7dha.github.io/JuraCUT/" target="_blank" rel="noreferrer">
          JuraCUT
        </a>{" "}
        and{" "}
        <a href="https://gm7dha.github.io/JuraDAW/" target="_blank" rel="noreferrer">
          JuraDAW
        </a>
        .
      </p>
      {egg && (
        <div className="easter-egg" role="dialog" aria-label="Surprise!" onClick={() => setEgg(false)} title="Click to close">
          <img src={`${import.meta.env.BASE_URL}easter-egg.jpg`} alt="A happy spaniel in a teal harness, standing on a carved log" />
        </div>
      )}
    </Modal>
  );
}
