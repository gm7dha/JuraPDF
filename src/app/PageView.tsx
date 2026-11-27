/**
 * The pages, one under another, in a scrolling window, or one whole page at a
 * time (the wheel, arrows and Page Up/Down flip pages).
 *
 * Only pages near the window are on the page at all (and drawn), and pages far
 * away are let go, so even PDFs with thousands of pages open quickly, scroll
 * smoothly and don't use much memory. While the zoom
 * changes, the old drawing is stretched until the sharp one is ready.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

import { useStore } from "../model/store";
import { CSS_PER_PT, PAGE_MARGIN_Y, currentPageAt, keepSpotInView, layoutPages, pagesAhead, pagesInView, resolveZoom, WHEEL_PAUSE, wheelFlip, wheelResting, type PageBox, type Size } from "../model/zoom";
import { drawPage, drawTextLayer, isCancelled, type PDFDocumentProxy } from "../pdf/pdfjs";
import { drawAhead, keepCanvas, keptCanvas } from "./pageCanvases";
import { keptAt } from "../model/additions";
import { keptIn, keptKnown } from "../pdf/items";
import { clickPage, endFieldDrag, fieldDragTo, startFieldAt, endShapeDrag, endStroke, finishAdding, justDragged, placeAt, startShapeAt, startStrokeAt, strokeTo, updateDraft } from "./addActions";
import { DraftBox } from "./DraftBox";
import { FormLayer } from "./FormLayer";
import { SearchHits } from "./SearchHits";

export function PageView() {
  const pdf = useStore((s) => s.pdf);
  const zoomMode = useStore((s) => s.zoom);
  const goTo = useStore((s) => s.goTo);
  const onePage = useStore((s) => s.onePage);
  const placing = useStore((s) => !!s.placing);
  const current = useStore((s) => s.currentPage);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Size>([0, 0]);

  // Follow the window's size (for the "fit" zooms).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView([el.clientWidth, el.clientHeight]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const allSizes = pdf?.sizes ?? [];
  // One page at a time: just the page being read, fitted on its own.
  const shownPage = Math.min(current, allSizes.length - 1);
  const sizes = useMemo(() => (onePage && allSizes.length ? [allSizes[shownPage]] : allSizes), [onePage, allSizes, shownPage]);
  const first = onePage ? shownPage : 0;
  const zoom = view[0] > 0 ? resolveZoom(zoomMode, sizes, view) : 1;
  const layout = useMemo(() => layoutPages(sizes, zoom), [sizes, zoom]);

  // The pages near the window (two and a half windows above and below): only these are on the page (drawn when within one and a half).
  const [range, setRange] = useState<[number, number]>([0, 4]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const updateRange = () => {
    const el = scroller.current;
    if (!el) return;
    const next = pagesInView(layoutRef.current.boxes, el.scrollTop, el.clientHeight, el.clientHeight * 2.5);
    setRange((r) => (r[0] === next[0] && r[1] === next[1] ? r : next));
  };

  // One page at a time: draw the pages ahead of time (mostly the way you're going), so flipping to them is instant.
  const lastShown = useRef({ page: 0, way: 1 as 1 | -1 });
  useEffect(() => {
    if (!onePage || !pdf || view[0] <= 0) return;
    const doc = pdf.doc;
    const last = lastShown.current;
    if (shownPage !== last.page) last.way = shownPage < last.page ? -1 : 1;
    last.page = shownPage;
    const way = last.way;
    const timer = setTimeout(() => {
      for (const n of pagesAhead(shownPage, way, allSizes.length)) {
        const size = allSizes[n];
        if (size) void drawAhead(doc, n, resolveZoom(zoomMode, [size], view) * CSS_PER_PT);
      }
      // A moment after the page itself was asked for, so it's drawn first.
    }, 30);
    return () => clearTimeout(timer);
  }, [onePage, pdf, shownPage, zoomMode, view, allSizes]);

  // Where the window was scrolled to, kept as it scrolls (the browser may clamp it before we can read it after a zoom).
  const scrollPos = useRef({ top: 0, left: 0 });
  // Where the zoom should stay put: a height in the window (the pointer for Ctrl + scroll, otherwise the top).
  const anchor = useRef(0);
  const before = useRef<{ boxes: PageBox[]; width: number; zoom: number } | null>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    const prev = before.current;
    if (el && prev && prev.zoom !== zoom && prev.boxes.length === layout.boxes.length) {
      const top = keepSpotInView(prev.boxes, layout.boxes, scrollPos.current.top, anchor.current);
      const middle = scrollPos.current.left + el.clientWidth / 2;
      const left = Math.max(0, (middle * layout.width) / Math.max(1, prev.width) - el.clientWidth / 2);
      el.scrollTop = top;
      el.scrollLeft = left;
      scrollPos.current = { top: el.scrollTop, left: el.scrollLeft };
    }
    anchor.current = 0;
    before.current = { boxes: layout.boxes, width: layout.width, zoom };
    useStore.getState().setShownZoom(zoom);
    updateRange();
  }, [layout, zoom, view]);

  // A new PDF starts at the top.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = 0;
    el.scrollLeft = 0;
    scrollPos.current = { top: 0, left: 0 };
    before.current = null;
    updateRange();
  }, [pdf?.openId]);

  // Where the view was scrolled to for a page asked for (until it's scrolled elsewhere).
  const jumped = useRef<number | null>(null);

  // Scroll to a page when asked (thumbnails, page number box, keys).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !goTo) return;
    if (onePage) {
      // The page asked for is the one shown: start at its top.
      el.scrollTop = 0;
      scrollPos.current.top = 0;
      return;
    }
    const box = layout.boxes[goTo.page];
    if (!box) return;
    el.scrollTop = Math.max(0, box.top - PAGE_MARGIN_Y / 2);
    scrollPos.current.top = el.scrollTop;
    // The page asked for stays the current one while the view stays put, even when it can't
    // scroll to the top of the window (the last pages of a PDF).
    jumped.current = el.scrollTop;
    updateRange();
  }, [goTo]);

  // Keep the page number up to date while scrolling.
  const frame = useRef(0);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    scrollPos.current = { top: el.scrollTop, left: el.scrollLeft };
    updateRange();
    if (onePageRef.current) return;
    if (jumped.current !== null && Math.abs(el.scrollTop - jumped.current) < 2) return;
    jumped.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      useStore.getState().setCurrentPage(currentPageAt(layout.boxes, el.scrollTop, el.clientHeight));
    });
  };

  // Ctrl + scroll (or a trackpad pinch) zooms towards the pointer.
  // One page at a time: the wheel flips pages (once the page has scrolled as far as it goes, if it's zoomed in).
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onePageRef = useRef(onePage);
  onePageRef.current = onePage;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let turned = 0;
    let restUntil = 0;
    let lastWheel = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        if (!onePageRef.current || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
        const canScroll = dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
        if (canScroll) {
          turned = 0;
          return;
        }
        e.preventDefault();
        // After a flip, let the rest of that wheel turn (a trackpad's glide) go by; a fresh turn after a pause flips at once.
        const now = performance.now();
        const gap = now - lastWheel;
        lastWheel = now;
        if (wheelResting(now, restUntil, gap)) return;
        if (gap >= WHEEL_PAUSE) turned = 0;
        const r = wheelFlip(turned, dy, false);
        turned = r.total;
        if (r.flip) {
          restUntil = now + 350;
          const s = useStore.getState();
          const count = s.pdf?.sizes.length ?? 0;
          const next = s.currentPage + r.flip;
          if (next >= 0 && next < count) {
            s.goToPage(next);
            // Going back shows the previous page from its bottom, as if scrolled up into it.
            if (r.flip < 0) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
          }
        }
        return;
      }
      e.preventDefault();
      const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const next = zoomRef.current * Math.exp(-Math.max(-60, Math.min(60, step)) * 0.006);
      anchor.current = e.clientY - el.getBoundingClientRect().top;
      useStore.getState().setZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className={`page-scroller${onePage ? " one-page" : ""}${placing ? " placing" : ""}`} ref={scroller} onScroll={onScroll} tabIndex={-1} aria-label="Pages">
      <div className="page-stack" style={{ height: layout.height, minWidth: layout.width }}>
        {pdf &&
          layout.boxes.slice(range[0], range[1] + 1).map((box, k) => {
            const i = range[0] + k;
            return <PageSlot key={first + i} doc={pdf.doc} index={first + i} box={box} zoom={zoom} root={scroller} />;
          })}
      </div>
    </div>
  );
}

interface SlotProps {
  doc: PDFDocumentProxy;
  index: number;
  box: PageBox;
  zoom: number;
  root: RefObject<HTMLDivElement>;
}

/** One page: its drawing, and its words laid over it (invisible, but selectable). */
const PageSlot = memo(function PageSlot({ doc, index, box, zoom, root }: SlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const cssScale = zoom * CSS_PER_PT;
  // A page drawn a moment ago (or ahead of time) counts as near straight away, so it shows at once.
  const [near, setNear] = useState(() => !!keptCanvas(doc, index, cssScale));
  const [drawn, setDrawn] = useState(false);
  /** The words layer's spans once it's built (for highlighting what the search bar found). */
  const [spans, setSpans] = useState<HTMLElement[] | null>(null);
  /** The version of the PDF the page was last drawn from. */
  const drawnFrom = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: root.current, rootMargin: "150% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  // Draw the page when it comes near, and again (sharp) after the zoom settles.
  // (Before the window is painted, so a kept drawing shows without a blank moment.)
  useLayoutEffect(() => {
    if (!near) {
      holder.current?.replaceChildren();
      setDrawn(false);
      return;
    }
    const ready = keptCanvas(doc, index, cssScale);
    if (ready && holder.current) {
      if (holder.current.firstChild !== ready) holder.current.replaceChildren(ready);
      drawnFrom.current = doc;
      setDrawn(true);
      return;
    }
    let stopped = false;
    let task: ReturnType<typeof drawPage> | null = null;
    const timer = setTimeout(
      async () => {
        try {
          const page = await doc.getPage(index + 1);
          if (stopped) return;
          const canvas = document.createElement("canvas");
          task = drawPage(page, canvas, cssScale);
          await task.promise;
          if (stopped || !holder.current) return;
          holder.current.replaceChildren(canvas);
          keepCanvas(doc, index, cssScale, canvas);
          drawnFrom.current = doc;
          setDrawn(true);
        } catch (e) {
          if (!isCancelled(e) && !stopped) console.warn(`Page ${index + 1} couldn't be drawn`, e);
        }
      },
      // While zooming, wait for the zoom to settle (the old drawing is stretched meanwhile); a change to the PDF shows straight away.
      holder.current?.firstChild && drawnFrom.current === doc ? 140 : 0,
    );
    return () => {
      stopped = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [near, cssScale, doc, index]);

  // The words: laid out once while the page is near; they follow the zoom by themselves (--scale-factor).
  useEffect(() => {
    const el = text.current;
    if (!near || !el) return;
    let stopped = false;
    let layer: ReturnType<typeof drawTextLayer> | null = null;
    void (async () => {
      try {
        const page = await doc.getPage(index + 1);
        if (stopped) return;
        layer = drawTextLayer(page, el, CSS_PER_PT);
        await layer.promise;
        if (!stopped) setSpans(layer.spans());
      } catch {
        // The page still shows; its words just can't be selected.
      }
    })();
    return () => {
      stopped = true;
      layer?.cancel();
      el.replaceChildren();
      setSpans(null);
    };
  }, [near, doc, index]);

  return (
    <div
      ref={ref}
      className={`page${drawn ? " drawn" : ""}`}
      onPointerDown={(e) => {
        // Drawing a shape: press, drag, let go. With the pen: each press, drag and let go is a stroke.
        const kind = useStore.getState().placing?.kind;
        if (e.button !== 0 || (kind !== "shape" && kind !== "ink" && kind !== "field")) return;
        e.preventDefault();
        const el = e.currentTarget;
        const box = el.getBoundingClientRect();
        const [pw, ph] = [box.width / cssScale, box.height / cssScale];
        const pt = (ev: { clientX: number; clientY: number }) => [
          Math.min(pw, Math.max(0, (ev.clientX - box.left) / cssScale)),
          Math.min(ph, Math.max(0, (ev.clientY - box.top) / cssScale)),
        ];
        const [x, y] = pt(e);
        if (kind === "ink") startStrokeAt(index, x, y);
        else if (kind === "field") startFieldAt(index, x, y);
        else startShapeAt(index, x, y);
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          // Every point the pointer passed through (browsers bunch quick moves together).
          const all = kind === "ink" && "getCoalescedEvents" in ev ? ev.getCoalescedEvents() : [ev];
          for (const one of all.length ? all : [ev]) {
            const [x2, y2] = pt(one);
            if (kind === "ink") strokeTo(x2, y2);
            else if (kind === "field") fieldDragTo(x2, y2);
            else updateDraft({ x2, y2 });
          }
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          if (kind === "ink") endStroke();
          else if (kind === "field") endFieldDrag();
          else endShapeDrag();
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
      onPointerMove={(e) => {
        // Things JuraPDF added show a hand: a click picks them to change.
        const s = useStore.getState();
        if (s.placing || s.draft || e.buttons || !s.pdf) return;
        if ((e.target as Element).closest(".form-box")) {
          e.currentTarget.classList.remove("over-kept");
          return;
        }
        const known = keptKnown(s.pdf.bytes);
        if (!known) {
          void keptIn(s.pdf.bytes);
          return;
        }
        const box = e.currentTarget.getBoundingClientRect();
        const over = keptAt(known[index] ?? [], (e.clientX - box.left) / cssScale, (e.clientY - box.top) / cssScale, false);
        e.currentTarget.classList.toggle("over-kept", !!over);
      }}
      onClick={(e) => {
        const s = useStore.getState();
        if (justDragged()) return;
        // Filling in a form box isn't a click on the page.
        if ((e.target as Element).closest(".form-box")) return;
        const box = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - box.left) / cssScale;
        const y = (e.clientY - box.top) / cssScale;
        if (s.placing) {
          placeAt(index, x, y);
          return;
        }
        // A click away from what's being placed puts it on the page (as in other PDF editors).
        if (s.draft) {
          void finishAdding();
          return;
        }
        if (window.getSelection()?.isCollapsed === false) return;
        void clickPage(index, x, y);
      }}
      data-page={index + 1}
      style={{ top: box.top, width: box.width, height: box.height, left: `calc(50% - ${box.width / 2}px)`, ["--scale-factor" as string]: cssScale }}
    >
      <div className="page-canvas" ref={holder} />
      <SearchHits index={index} spans={spans} />
      <div className="textLayer" ref={text} />
      {near && <FormLayer doc={doc} index={index} scale={cssScale} />}
      <DraftBox index={index} scale={cssScale} />
      {!drawn && <span className="page-loading">Page {index + 1}</span>}
    </div>
  );
});
