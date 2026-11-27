/**
 * The panel down the left: the pages (small pictures), the bookmarks or the notes, picked
 * with the tabs at its top. Drag its right edge to make it wider or narrower.
 */
import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { DEFAULT_SIDE_WIDTH, clampSideWidth } from "../model/sidePanel";
import { useStore, type SidePane } from "../model/store";
import { Bookmarks } from "./Bookmarks";
import { NotesList } from "./NotesList";
import { Thumbnails } from "./Thumbnails";

const TABS: { pane: SidePane; label: string }[] = [
  { pane: "pages", label: "Pages" },
  { pane: "bookmarks", label: "Bookmarks" },
  { pane: "notes", label: "Notes" },
];

export function SidePanel() {
  const pane = useStore((s) => s.sidePane);
  const width = useStore((s) => s.sideWidth[s.sidePane]);
  return (
    <aside className={`side-panel ${pane}`}>
      <div className="side-tabs" role="tablist" aria-label="Side panel">
        {TABS.map((t) => (
          <button
            key={t.pane}
            type="button"
            role="tab"
            id={`side-tab-${t.pane}`}
            aria-selected={pane === t.pane}
            aria-controls="side-pane"
            className={`side-tab${pane === t.pane ? " active" : ""}`}
            onClick={() => useStore.getState().setSidePane(t.pane)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="side-pane" id="side-pane" role="tabpanel" aria-labelledby={`side-tab-${pane}`}>
        {pane === "pages" ? <Thumbnails /> : pane === "bookmarks" ? <Bookmarks /> : <NotesList />}
      </div>
      <ResizeEdge pane={pane} width={width} />
    </aside>
  );
}

/** The panel's right edge, which can be dragged; ← → (Shift for bigger steps) work too, and a double-click goes back to the starting width. */
function ResizeEdge({ pane, width }: { pane: SidePane; width: number }) {
  const [dragging, setDragging] = useState(false);
  const set = (w: number, remember: boolean) => useStore.getState().setSideWidth(pane, clampSideWidth(w, window.innerWidth), remember);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = width;
    setDragging(true);
    document.body.classList.add("resizing-side");
    const move = (ev: globalThis.PointerEvent) => set(startWidth + ev.clientX - startX, false);
    const up = (ev: globalThis.PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing-side");
      setDragging(false);
      set(startWidth + ev.clientX - startX, true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") set(width + (e.key === "ArrowRight" ? step : -step), true);
    else if (e.key === "Home") set(DEFAULT_SIDE_WIDTH[pane], true);
    else return;
    e.preventDefault();
    // Not the page view's arrow keys (which turn pages).
    e.stopPropagation();
  };

  return (
    <div
      className={`side-resize${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width"
      aria-valuenow={width}
      aria-valuemin={130}
      tabIndex={0}
      title="Drag to make the panel wider or narrower (double-click for the usual width)"
      onPointerDown={onPointerDown}
      onDoubleClick={() => set(DEFAULT_SIDE_WIDTH[pane], true)}
      onKeyDown={onKeyDown}
    />
  );
}
