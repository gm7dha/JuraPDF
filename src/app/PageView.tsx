/**
 * The pages, one under another, in a scrolling window, or one whole page at a
 * time (the wheel, arrows and Page Up/Down flip pages).
 *
 * Only pages near the window are drawn (and pages far away are let go), so
 * even very long PDFs open quickly and don't use much memory. While the zoom
 * changes, the old drawing is stretched until the sharp one is ready.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

import { useStore } from "../model/store";
import { CSS_PER_PT, PAGE_MARGIN_Y, currentPageAt, keepSpotInView, layoutPages, resolveZoom, wheelFlip, type PageBox, type Size } from "../model/zoom";
import { drawPage, drawTextLayer, isCancelled, type PDFDocumentProxy } from "../pdf/pdfjs";
import { placeAt } from "./addActions";
import { DraftBox } from "./DraftBox";

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
  }, [layout, zoom]);

  // A new PDF starts at the top.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = 0;
    el.scrollLeft = 0;
    scrollPos.current = { top: 0, left: 0 };
    before.current = null;
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
  }, [goTo]);

  // Keep the page number up to date while scrolling.
  const frame = useRef(0);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    scrollPos.current = { top: el.scrollTop, left: el.scrollLeft };
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
        // After a flip, let the rest of that wheel turn (a trackpad's glide) go by.
        if (performance.now() < restUntil) return;
        const r = wheelFlip(turned, dy, false);
        turned = r.total;
        if (r.flip) {
          restUntil = performance.now() + 350;
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
          layout.boxes.map((box, i) => (
            <PageSlot key={first + i} doc={pdf.doc} index={first + i} box={box} zoom={zoom} root={scroller} />
          ))}
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
  const [near, setNear] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const cssScale = zoom * CSS_PER_PT;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: root.current, rootMargin: "150% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  // Draw the page when it comes near, and again (sharp) after the zoom settles.
  useEffect(() => {
    if (!near) {
      holder.current?.replaceChildren();
      setDrawn(false);
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
          setDrawn(true);
        } catch (e) {
          if (!isCancelled(e) && !stopped) console.warn(`Page ${index + 1} couldn't be drawn`, e);
        }
      },
      holder.current?.firstChild ? 140 : 0,
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
    let layer: Awaited<ReturnType<typeof drawTextLayer>> | null = null;
    void (async () => {
      try {
        const page = await doc.getPage(index + 1);
        if (stopped) return;
        layer = await drawTextLayer(page, el, CSS_PER_PT);
      } catch {
        // The page still shows; its words just can't be selected.
      }
    })();
    return () => {
      stopped = true;
      layer?.cancel();
      el.replaceChildren();
    };
  }, [near, doc, index]);

  return (
    <div
      ref={ref}
      className={`page${drawn ? " drawn" : ""}`}
      onClick={(e) => {
        if (!useStore.getState().placing) return;
        const box = e.currentTarget.getBoundingClientRect();
        placeAt(index, (e.clientX - box.left) / cssScale, (e.clientY - box.top) / cssScale);
      }}
      data-page={index + 1}
      style={{ top: box.top, width: box.width, height: box.height, left: `calc(50% - ${box.width / 2}px)`, ["--scale-factor" as string]: cssScale }}
    >
      <div className="page-canvas" ref={holder} />
      <div className="textLayer" ref={text} />
      <DraftBox index={index} scale={cssScale} />
      {!drawn && <span className="page-loading">Page {index + 1}</span>}
    </div>
  );
});
