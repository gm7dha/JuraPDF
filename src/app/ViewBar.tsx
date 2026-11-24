/** The bar under the top bar: the page list, which page you're on, the zoom, and the page buttons. */
import { useEffect, useState } from "react";

import { pagesLabel, targetPages } from "../model/pages";
import { useStore } from "../model/store";
import { paperName, sizeLabel } from "../model/pdfFile";
import { parsePageNumber, parseZoom, zoomIn, zoomLabel, zoomOut } from "../model/zoom";
import { cancelAdding, startPicture, startWords } from "./addActions";
import { Icons } from "./icons";
import { addBlank, deleteChosen, insertFromFile, moveChosen, saveChosenAsNew, turnChosen } from "./pageActions";
import { detectPlatform, shortcut } from "./platform";

export function ViewBar() {
  const pdf = useStore((s) => s.pdf);
  const current = useStore((s) => s.currentPage);
  const zoom = useStore((s) => s.zoom);
  const shown = useStore((s) => s.shownZoom);
  const sidebar = useStore((s) => s.sidebar);
  const placing = useStore((s) => s.placing?.kind ?? null);
  const draftKind = useStore((s) => s.draft?.kind ?? null);
  const selected = useStore((s) => s.selected);
  const onePage = useStore((s) => s.onePage);
  const s = useStore.getState;
  const count = pdf?.sizes.length ?? 0;
  const platform = detectPlatform();

  const [pageText, setPageText] = useState(String(current + 1));
  useEffect(() => setPageText(String(current + 1)), [current, pdf]);
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
        <button type="button" className="icon-button" onClick={() => void insertFromFile()} aria-label="Bring in pages from another PDF" title={`Bring in all the pages of another PDF, after ${which}`}>
          <Icons.BringIn />
        </button>
        <button type="button" className="icon-button" onClick={() => void saveChosenAsNew()} aria-label="Save pages as a new PDF" title={`Save ${these} as a new PDF`}>
          <Icons.SaveOut />
        </button>
      </div>
      <span className="viewbar-divider" />
      <div className="page-tools" role="group" aria-label="Add to a page">
        <button
          type="button"
          className={`icon-button${placing === "words" || draftKind === "words" ? " active" : ""}`}
          onClick={() => (placing === "words" ? cancelAdding() : startWords())}
          aria-label="Add words"
          title="Add words to a page: click where they should go, then type"
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
      </div>
      <div className="topbar-spacer" />
      <span className="doc-facts muted" title="This page's paper size, how many pages the PDF has, and its file size">
        {size ? paperName(size[0], size[1]) : ""} · {count} {count === 1 ? "page" : "pages"} · {sizeLabel(pdf.bytes.length)}
      </span>
    </div>
  );
}
