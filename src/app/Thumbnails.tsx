/**
 * The small pictures of the pages down the left. Click one to go to that page;
 * Ctrl/⌘-click or Shift-click to pick several; drag them to move them.
 */
import { memo, useEffect, useRef, useState, type DragEvent, type MouseEvent, type RefObject } from "react";

import { useStore } from "../model/store";
import type { Size } from "../model/zoom";
import { drawPage, isCancelled, type PDFDocumentProxy } from "../pdf/pdfjs";
import { movePagesTo } from "./pageActions";
import { detectPlatform } from "./platform";

const isMac = () => detectPlatform() === "mac";

/** How wide a thumbnail is, in CSS pixels. */
const THUMB_WIDTH = 120;

/** The pages being dragged in the list (null when nothing from the list is). */
let dragging: number[] | null = null;

export function Thumbnails() {
  const pdf = useStore((s) => s.pdf);
  const current = useStore((s) => s.currentPage);
  const selected = useStore((s) => s.selected);
  const list = useRef<HTMLDivElement>(null);
  /** Where dragged pages would land: before this page (count = at the end). */
  const [dropAt, setDropAt] = useState<number | null>(null);

  // Keep the page being read in sight in the list.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-thumb="${current + 1}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  if (!pdf) return null;
  const count = pdf.sizes.length;
  const picked = new Set(selected);

  const onDragOver = (e: DragEvent, i: number) => {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = e.clientY < box.top + box.height / 2 ? i : i + 1;
    if (at !== dropAt) setDropAt(at);
  };
  const onDrop = (e: DragEvent) => {
    if (!dragging || dropAt === null) return;
    e.preventDefault();
    const pages = dragging;
    dragging = null;
    setDropAt(null);
    void movePagesTo(pages, dropAt);
  };

  return (
    <nav
      className="thumbnails"
      ref={list}
      aria-label="Pages"
      onDragLeave={(e) => {
        if (!list.current?.contains(e.relatedTarget as Node | null)) setDropAt(null);
      }}
      onDrop={onDrop}
    >
      {pdf.sizes.map((size, i) => (
        <Thumb
          key={i}
          doc={pdf.doc}
          index={i}
          size={size}
          active={i === current}
          picked={picked.has(i)}
          dropMark={dropAt === i ? "before" : dropAt === count && i === count - 1 ? "after" : null}
          root={list}
          onDragOver={onDragOver}
          onDragEnd={() => {
            dragging = null;
            setDropAt(null);
          }}
        />
      ))}
      {selected.length > 1 && (
        <p className="thumbs-picked muted">
          {selected.length} pages picked.{" "}
          <button type="button" className="link-button" onClick={() => useStore.getState().setSelected([])}>
            Clear
          </button>
        </p>
      )}
    </nav>
  );
}

interface ThumbProps {
  doc: PDFDocumentProxy;
  index: number;
  size: Size;
  active: boolean;
  picked: boolean;
  dropMark: "before" | "after" | null;
  root: RefObject<HTMLDivElement>;
  onDragOver(e: DragEvent, i: number): void;
  onDragEnd(): void;
}

const Thumb = memo(function Thumb({ doc, index, size, active, picked, dropMark, root, onDragOver, onDragEnd }: ThumbProps) {
  const ref = useRef<HTMLDivElement>(null);
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

  const click = (e: MouseEvent) => {
    const toggle = isMac() ? e.metaKey : e.ctrlKey;
    useStore.getState().pickPage(index, e.shiftKey ? "run" : toggle ? "toggle" : "only");
  };

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      draggable
      className={`thumb${active ? " active" : ""}${picked ? " picked" : ""}${dropMark ? ` drop-${dropMark}` : ""}`}
      data-thumb={index + 1}
      aria-current={active ? "page" : undefined}
      aria-pressed={picked}
      title={`Page ${index + 1}. Click to go to it, ${isMac() ? "⌘" : "Ctrl"}-click or Shift-click to pick several, drag to move.`}
      onClick={click}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          useStore.getState().pickPage(index, "only");
        }
      }}
      onDragStart={(e) => {
        const { selected } = useStore.getState();
        dragging = selected.includes(index) ? selected : [index];
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `pages ${dragging.map((p) => p + 1).join(", ")}`);
      }}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
    >
      <div className="thumb-picture" ref={holder} style={{ width: THUMB_WIDTH, height }} />
      <span className="thumb-number">{index + 1}</span>
    </div>
  );
});
