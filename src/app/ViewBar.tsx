/** The bar under the top bar: the page list, which page you're on, the zoom, and the page buttons. */
import { useEffect, useState } from "react";

import { pagesLabel, targetPages } from "../model/pages";
import { useStore } from "../model/store";
import { paperName, sizeLabel } from "../model/pdfFile";
import { parsePageNumber, parseZoom, zoomIn, zoomLabel, zoomOut } from "../model/zoom";
import { SHAPE_NAMES, type ShapeKind } from "../model/additions";
import { cancelAdding, startChanging, startField, startInk, startPicture, startShape, startWords } from "./addActions";
import { Icons } from "./icons";
import { savePagesAsPictures, saveWordsAsText } from "./exportActions";
import { readWordsInPictures } from "./ocrActions";
import { emptyForm, fixAnswers, hasForm } from "./formActions";
import { addBlank, deleteChosen, insertFromFile, moveChosen, saveChosenAsNew, turnChosen } from "./pageActions";
import { detectPlatform, shortcut } from "./platform";
import { closeSearch, openSearch } from "./searchActions";

const SHAPES: { shape: ShapeKind; icon: (p: { size?: number }) => JSX.Element; tip: string }[] = [
  { shape: "highlight", icon: Icons.Highlight, tip: "Highlight: drag across words to colour them in, see-through so they still show (H)" },
  { shape: "box", icon: Icons.Box, tip: "Draw a box: drag from one corner to the other; it can be filled in too (R)" },
  { shape: "oval", icon: Icons.Oval, tip: "Draw an oval: drag across where it should go; it can be filled in too (O)" },
  { shape: "line", icon: Icons.Line, tip: "Draw a line: drag from one end to the other (L)" },
  { shape: "arrow", icon: Icons.Arrow, tip: "Draw an arrow: drag from its tail to where it points (A)" },
];

export function ViewBar() {
  const pdf = useStore((s) => s.pdf);
  const current = useStore((s) => s.currentPage);
  const zoom = useStore((s) => s.zoom);
  const shown = useStore((s) => s.shownZoom);
  const sidebar = useStore((s) => s.sidebar);
  const placing = useStore((s) => s.placing?.kind ?? null);
  const draftKind = useStore((s) => s.draft?.kind ?? null);
  const placingShape = useStore((s) => (s.placing?.kind === "shape" ? s.placing.shape : null));
  const draftShape = useStore((s) => (s.draft?.kind === "shape" ? s.draft.shape : null));
  const reading = useStore((s) => s.reading);
  const changing = useStore((s) => s.placing?.kind === "change" || s.draft?.kind === "existing" || (s.draft?.kind === "words" && !!s.draft.cover) || (!!s.draft && "id" in s.draft && s.draft.id !== undefined));
  const fielding = useStore((s) => s.placing?.kind === "field" || (s.draft?.kind === "field" && s.draft.id === undefined));
  const inking = useStore((s) => s.placing?.kind === "ink" || (s.draft?.kind === "ink" && s.draft.id === undefined));
  const selected = useStore((s) => s.selected);
  const onePage = useStore((s) => s.onePage);
  const searching = useStore((s) => !!s.search);
  const s = useStore.getState;
  const count = pdf?.sizes.length ?? 0;
  const platform = detectPlatform();

  const [pageText, setPageText] = useState(String(current + 1));
  useEffect(() => setPageText(String(current + 1)), [current, pdf]);
  // Whether this version has a form to fill in (for the form's own buttons).
  const [form, setForm] = useState(false);
  useEffect(() => {
    let stopped = false;
    if (!pdf) setForm(false);
    else void hasForm(pdf.doc).then((has) => !stopped && setForm(has));
    return () => {
      stopped = true;
    };
  }, [pdf?.doc]);
  const [zoomText, setZoomText] = useState(zoomLabel(shown));
  useEffect(() => setZoomText(zoomLabel(shown)), [shown]);

  if (!pdf) return null;
  const size = pdf.sizes[current];
  const pages = targetPages(selected, current, count);
  const which = pagesLabel(pages);
  const these = selected.length ? `the picked ${pages.length === 1 ? "page" : "pages"} (${which})` : `this page (${which})`;

  return (
    <div className="viewbar" role="toolbar" aria-label="Pages and zoom">
      <button
        type="button"
        className={`icon-button${sidebar ? " active" : ""}`}
        onClick={() => s().toggleSidebar()}
        aria-pressed={sidebar}
        aria-label="Page list"
        title={sidebar ? "Hide the pages and bookmarks" : "Show the pages and bookmarks"}
      >
        <Icons.Sidebar />
      </button>
      <span className="viewbar-divider" />
      <button type="button" className="icon-button" onClick={() => s().goToPage(current - 1)} disabled={current <= 0} aria-label="Previous page" title="Previous page (←)">
        <Icons.Up />
      </button>
      <button type="button" className="icon-button" onClick={() => s().goToPage(current + 1)} disabled={current >= count - 1} aria-label="Next page" title="Next page (→)">
        <Icons.Down />
      </button>
      <label className="page-number" title="Type a page number and press Enter">
        <span className="visually-hidden">Page</span>
        <input
          className="small-box"
          inputMode="numeric"
          value={pageText}
          aria-label="Page number"
          onChange={(e) => setPageText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => setPageText(String(useStore.getState().currentPage + 1))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const n = parsePageNumber(pageText, count);
              if (n) s().goToPage(n - 1);
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="muted">of {count}</span>
      </label>
      <button
        type="button"
        className={`icon-button${searching ? " active" : ""}`}
        onClick={() => (searching ? closeSearch() : openSearch())}
        aria-pressed={searching}
        aria-label="Find words"
        title={`Find words anywhere in the PDF (${shortcut(platform, "F")})`}
      >
        <Icons.Search />
      </button>
      <span className="viewbar-divider" />
      <button type="button" className="icon-button" onClick={() => s().setZoom(zoomOut(shown))} aria-label="Zoom out" title={`Zoom out (${shortcut(platform, "−")})`}>
        <Icons.Minus />
      </button>
      <input
        className="small-box zoom-box"
        value={zoomText}
        aria-label="Zoom"
        title="Type a zoom, e.g. 150%, and press Enter"
        onChange={(e) => setZoomText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => setZoomText(zoomLabel(useStore.getState().shownZoom))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const z = parseZoom(zoomText);
            if (z) s().setZoom(z);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
      />
      <button type="button" className="icon-button" onClick={() => s().setZoom(zoomIn(shown))} aria-label="Zoom in" title={`Zoom in (${shortcut(platform, "+")})`}>
        <Icons.Plus />
      </button>
      <button
        type="button"
        className={`icon-button${zoom === "width" ? " active" : ""}`}
        onClick={() => s().setZoom("width")}
        aria-pressed={zoom === "width"}
        aria-label="Fit to width"
        title={`Fit the page's width to the window (${shortcut(platform, "0")})`}
      >
        <Icons.FitWidth />
      </button>
      <button
        type="button"
        className={`icon-button${zoom === "page" ? " active" : ""}`}
        onClick={() => s().setZoom("page")}
        aria-pressed={zoom === "page"}
        aria-label="Fit whole page"
        title="Show the whole page"
      >
        <Icons.FitPage />
      </button>
      <button
        type="button"
        className={`icon-button${onePage ? " active" : ""}`}
        onClick={() => s().setOnePage(!onePage)}
        aria-pressed={onePage}
        aria-label="One page at a time"
        title={onePage ? "Show the pages one under another again" : "Show one whole page at a time: scrolling or the arrow keys flip to the next or previous page"}
      >
        <Icons.OnePage />
      </button>
      <button type="button" className={`text-button compact${zoom === 1 ? " active" : ""}`} onClick={() => s().setZoom(1)} title={`Real size (${shortcut(platform, "1")})`}>
        100%
      </button>
      <span className="viewbar-divider" />
      <div className="page-tools" role="group" aria-label="Change pages">
        <button type="button" className="icon-button" onClick={() => void turnChosen(-90)} aria-label="Turn left" title={`Turn ${these} a quarter turn anticlockwise`}>
          <Icons.TurnLeft />
        </button>
        <button type="button" className="icon-button" onClick={() => void turnChosen(90)} aria-label="Turn right" title={`Turn ${these} a quarter turn clockwise`}>
          <Icons.TurnRight />
        </button>
        <button type="button" className="icon-button" onClick={() => void moveChosen(-1)} disabled={pages[0] === 0} aria-label="Move up" title={`Move ${these} one place earlier (or drag pages in the page list)`}>
          <Icons.MoveUp />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => void moveChosen(1)}
          disabled={pages[pages.length - 1] === count - 1}
          aria-label="Move down"
          title={`Move ${these} one place later (or drag pages in the page list)`}
        >
          <Icons.MoveDown />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => void deleteChosen()}
          disabled={pages.length >= count}
          aria-label="Delete pages"
          title={pages.length >= count ? "A PDF needs at least one page" : `Delete ${these} (Delete key when pages are picked)`}
        >
          <Icons.Bin />
        </button>
        <button type="button" className="icon-button" onClick={() => void addBlank()} aria-label="Add a blank page" title={`Add a blank page after ${which}`}>
          <Icons.AddPage />
        </button>
        <button type="button" className="icon-button" onClick={() => void insertFromFile()} aria-label="Bring in pages from another PDF or pictures" title={`Bring in all the pages of another PDF, or pictures (PNG or JPG) as new pages, after ${which}`}>
          <Icons.BringIn />
        </button>
        <button type="button" className="icon-button" onClick={() => void saveChosenAsNew()} aria-label="Save pages as a new PDF" title={`Save ${these} as a new PDF`}>
          <Icons.SaveOut />
        </button>
        <button type="button" className="icon-button" onClick={() => void savePagesAsPictures()} aria-label="Save pages as pictures" title={`Save ${these} as pictures (PNG; several pages come in a zip file)`}>
          <Icons.SavePicture />
        </button>
        <button type="button" className="icon-button" onClick={() => void saveWordsAsText()} aria-label="Save the words as text" title="Save all the words in this PDF as a text file">
          <Icons.SaveText />
        </button>
      </div>
      <span className="viewbar-divider" />
      <div className="page-tools" role="group" aria-label="Add to a page">
        <button
          type="button"
          className={`icon-button${changing ? " active" : ""}`}
          onClick={() => (changing ? cancelAdding() : void startChanging())}
          aria-label="Change what's on a page"
          title="Change what's already on a page: click anything you added, a picture or some words to move, resize, restyle or delete it (E). Things you added can also be clicked any time."
        >
          <Icons.Pencil />
        </button>
        <button
          type="button"
          className={`icon-button${placing === "words" || (draftKind === "words" && !changing) ? " active" : ""}`}
          onClick={() => (placing === "words" ? cancelAdding() : void startWords())}
          aria-label="Add words"
          title="Add words to a page: click where they should go, then type (T)"
        >
          <Icons.Words />
        </button>
        <button
          type="button"
          className={`icon-button${placing === "picture" || draftKind === "picture" ? " active" : ""}`}
          onClick={() => (placing === "picture" ? cancelAdding() : void startPicture())}
          aria-label="Add a picture"
          title="Add a picture (PNG or JPG) to a page: choose it, then click where it should go"
        >
          <Icons.Picture />
        </button>
        {SHAPES.map(({ shape, icon: Icon, tip }) => {
          const on = placingShape === shape || draftShape === shape;
          return (
            <button
              key={shape}
              type="button"
              className={`icon-button${on ? " active" : ""}`}
              onClick={() => (on ? cancelAdding() : void startShape(shape))}
              aria-label={shape === "highlight" ? "Highlight" : `Draw ${shape === "oval" || shape === "arrow" ? "an" : "a"} ${SHAPE_NAMES[shape].toLowerCase()}`}
              title={tip}
            >
              <Icon />
            </button>
          );
        })}
        <button
          type="button"
          className={`icon-button${inking ? " active" : ""}`}
          onClick={() => (inking ? cancelAdding() : void startInk())}
          aria-label="Draw freehand"
          title="Draw freehand, like a pen: drag on a page, as many strokes as you like, then Done (P)"
        >
          <Icons.Pen />
        </button>
        <button
          type="button"
          className={`icon-button${fielding ? " active" : ""}`}
          onClick={() => (fielding ? cancelAdding() : void startField())}
          aria-label="Add a form box"
          title="Add a form box: a box to type in, a tick box or a list to choose from, that Acrobat, Preview and other readers can fill in (F)"
        >
          <Icons.Form />
        </button>
        {form && (
          <>
            <button
              type="button"
              className="icon-button"
              onClick={() => void emptyForm()}
              aria-label="Empty the form"
              title="Empty the form: take out everything typed, ticked or picked in its boxes (Undo brings it back)"
            >
              <Icons.Eraser />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => void fixAnswers()}
              aria-label="Make the answers part of the pages"
              title="Make the answers part of the pages: what's filled in stays where it is, but the form boxes go, so nobody can change the answers (Undo brings them back)"
            >
              <Icons.Lock />
            </button>
          </>
        )}
        <button
          type="button"
          className="icon-button"
          onClick={() => s().openDialog("headers")}
          aria-label="Headers and footers"
          title="Headers, footers and page numbers: words or numbers along the top and bottom of the pages (Bates numbers too)"
        >
          <Icons.PageNumbers />
        </button>
        {form && (
          <>
            <button
              type="button"
              className="icon-button"
              onClick={() => void emptyForm()}
              aria-label="Empty the form"
              title="Empty the form: take out everything typed, ticked or picked in its boxes (Undo brings it back)"
            >
              <Icons.Eraser />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => void fixAnswers()}
              aria-label="Make the answers part of the pages"
              title="Make the answers part of the pages: what's filled in stays where it is, but the form boxes go, so nobody can change the answers (Undo brings them back)"
            >
              <Icons.Lock />
            </button>
          </>
        )}
        <button
          type="button"
          className={`icon-button${reading !== null ? " active" : ""}`}
          onClick={() => void readWordsInPictures()}
          disabled={reading !== null}
          aria-label="Read words in pictures"
          title={`Find the words in the pictures on ${which} (a scan or a photo), so they can be picked, copied and found`}
        >
          <Icons.ReadWords />
        </button>
        {reading !== null && (
          <span className="reading-note muted" role="status">
            Reading… {Math.round(reading * 100)}%
          </span>
        )}
      </div>
      <div className="topbar-spacer" />
      <span className="doc-facts muted" title="This page's paper size, how many pages the PDF has, and its file size">
        {size ? paperName(size[0], size[1]) : ""} · {count} {count === 1 ? "page" : "pages"} · {sizeLabel(pdf.bytes.length)}
      </span>
    </div>
  );
}
