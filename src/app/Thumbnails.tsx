/** The small pictures of the pages down the left. Click one to go to that page. */
import { memo, useEffect, useRef, useState, type RefObject } from "react";

import { useStore } from "../model/store";
import type { Size } from "../model/zoom";
import { drawPage, isCancelled, type PDFDocumentProxy } from "../pdf/pdfjs";

/** How wide a thumbnail is, in CSS pixels. */
const THUMB_WIDTH = 120;

export function Thumbnails() {
  const pdf = useStore((s) => s.pdf);
  const current = useStore((s) => s.currentPage);
  const list = useRef<HTMLDivElement>(null);

  // Keep the page being read in sight in the list.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-thumb="${current + 1}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  if (!pdf) return null;
  return (
    <nav className="thumbnails" ref={list} aria-label="Pages">
      {pdf.sizes.map((size, i) => (
        <Thumb key={i} doc={pdf.doc} index={i} size={size} active={i === current} root={list} />
      ))}
    </nav>
  );
}

interface ThumbProps {
  doc: PDFDocumentProxy;
  index: number;
  size: Size;
  active: boolean;
  root: RefObject<HTMLDivElement>;
}

const Thumb = memo(function Thumb({ doc, index, size, active, root }: ThumbProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const scale = THUMB_WIDTH / Math.max(1, size[0]);
  const height = Math.round(size[1] * scale);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setNear(true), { root: root.current, rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  // Drawn once, when it first comes near.
  useEffect(() => {
    if (!near) return;
    let stopped = false;
    let task: ReturnType<typeof drawPage> | null = null;
    void (async () => {
      try {
        const page = await doc.getPage(index + 1);
        if (stopped) return;
        const canvas = document.createElement("canvas");
        task = drawPage(page, canvas, scale);
        await task.promise;
        if (!stopped) holder.current?.replaceChildren(canvas);
      } catch (e) {
        if (!isCancelled(e)) console.warn(`Thumbnail ${index + 1} couldn't be drawn`, e);
      }
    })();
    return () => {
      stopped = true;
      task?.cancel();
    };
  }, [near, doc, index, scale]);

  return (
    <button
      ref={ref}
      type="button"
      className={`thumb${active ? " active" : ""}`}
      data-thumb={index + 1}
      aria-current={active ? "page" : undefined}
      title={`Go to page ${index + 1}`}
      onClick={() => useStore.getState().goToPage(index)}
    >
      <div className="thumb-picture" ref={holder} style={{ width: THUMB_WIDTH, height }} />
      <span className="thumb-number">{index + 1}</span>
    </button>
  );
});
