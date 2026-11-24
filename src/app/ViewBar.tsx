/** The bar under the top bar: the page list, which page you're on, and the zoom. */
import { useEffect, useState } from "react";

import { useStore } from "../model/store";
import { paperName, sizeLabel } from "../model/pdfFile";
import { parsePageNumber, parseZoom, zoomIn, zoomLabel, zoomOut } from "../model/zoom";
import { Icons } from "./icons";
import { detectPlatform, shortcut } from "./platform";

export function ViewBar() {
  const pdf = useStore((s) => s.pdf);
  const current = useStore((s) => s.currentPage);
  const zoom = useStore((s) => s.zoom);
  const shown = useStore((s) => s.shownZoom);
  const sidebar = useStore((s) => s.sidebar);
  const s = useStore.getState;
  const count = pdf?.sizes.length ?? 0;
  const platform = detectPlatform();

  const [pageText, setPageText] = useState(String(current + 1));
  useEffect(() => setPageText(String(current + 1)), [current, pdf]);
  const [zoomText, setZoomText] = useState(zoomLabel(shown));
  useEffect(() => setZoomText(zoomLabel(shown)), [shown]);

  if (!pdf) return null;
  const size = pdf.sizes[current];

  return (
    <div className="viewbar" role="toolbar" aria-label="Pages and zoom">
      <button
        type="button"
        className={`icon-button${sidebar ? " active" : ""}`}
        onClick={() => s().toggleSidebar()}
        aria-pressed={sidebar}
        aria-label="Page list"
        title={sidebar ? "Hide the page list" : "Show the page list"}
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
      <button type="button" className={`text-button compact${zoom === 1 ? " active" : ""}`} onClick={() => s().setZoom(1)} title={`Real size (${shortcut(platform, "1")})`}>
        100%
      </button>
      <div className="topbar-spacer" />
      <span className="doc-facts muted" title="This page's paper size, how many pages the PDF has, and its file size">
        {size ? paperName(size[0], size[1]) : ""} · {count} {count === 1 ? "page" : "pages"} · {sizeLabel(pdf.bytes.length)}
      </span>
    </div>
  );
}
