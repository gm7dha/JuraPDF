/**
 * The small pictures of the pages down the left. Click one to go to that page;
 * Ctrl/⌘-click or Shift-click to pick several; drag them to move them.
 */
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type RefObject,
} from "react";

import { THUMB_EXTRA, thumbLayout, thumbWidthFor } from "../model/sidePanel";
import { useStore } from "../model/store";
import { pagesInView, type Size } from "../model/zoom";
import { drawPage, isCancelled, type PDFDocumentProxy } from "../pdf/pdfjs";
import { movePagesTo } from "./pageActions";
import { detectPlatform } from "./platform";

/** Worked out once (it's asked for by every picture in the list). */
let mac: boolean | null = null;
const isMac = () => (mac ??= detectPlatform() === "mac");

/** The pages being dragged in the list (null when nothing from the list is). */
let dragging: number[] | null = null;

export function Thumbnails() {
  const pdf = useStore((s) => s.pdf);
  const current = useStore((s) => s.currentPage);
  const selected = useStore((s) => s.selected);
  const thumbWidth = useSettled(
    thumbWidthFor(useStore((s) => s.sideWidth.pages)),
  );
  const list = useRef<HTMLDivElement>(null);
  /** Where dragged pages would land: before this page (count = at the end). */
  const [dropAt, setDropAt] = useState<number | null>(null);

  const sizes = pdf?.sizes;
  const layout = useMemo(
    () => thumbLayout(sizes ?? [], thumbWidth),
    [sizes, thumbWidth],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Only the pictures near the list's window are made (a long PDF can have thousands).
  const [range, setRange] = useState<[number, number]>([0, 9]);
  const updateRange = () => {
    const el = list.current;
    if (!el) return;
    const next = pagesInView(
      layoutRef.current.boxes,
      el.scrollTop,
      el.clientHeight,
      el.clientHeight,
    );
    setRange((r) => (r[0] === next[0] && r[1] === next[1] ? r : next));
  };
  useLayoutEffect(updateRange, [layout]);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(updateRange);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the page being read in sight in the list.
  useEffect(() => {
    const el = list.current;
    const box = layoutRef.current.boxes[current];
    if (!el || !box) return;
    if (box.top < el.scrollTop) el.scrollTop = box.top - 8;
    else if (box.top + box.height > el.scrollTop + el.clientHeight)
      el.scrollTop = box.top + box.height - el.clientHeight + 8;
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
        if (!list.current?.contains(e.relatedTarget as Node | null))
          setDropAt(null);
      }}
      onDrop={onDrop}
      onScroll={updateRange}
    >
      <div className="thumbs-track" style={{ height: layout.height }}>
        {pdf.sizes.slice(range[0], range[1] + 1).map((size, k) => {
          const i = range[0] + k;
          return (
            <Thumb
              key={i}
              doc={pdf.doc}
              index={i}
              size={size}
              top={layout.boxes[i].top}
              width={thumbWidth}
              active={i === current}
              picked={picked.has(i)}
              dropMark={
                dropAt === i
                  ? "before"
                  : dropAt === count && i === count - 1
                    ? "after"
                    : null
              }
              root={list}
              onDragOver={onDragOver}
              onDragEnd={() => {
                dragging = null;
                setDropAt(null);
              }}
            />
          );
        })}
      </div>
      {selected.length > 1 && (
        <p className="thumbs-picked muted">
          {selected.length} pages picked.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => useStore.getState().setSelected([])}
          >
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
  /** Where it sits down the list, in CSS pixels. */
  top: number;
  /** How wide it is, in CSS pixels. */
  width: number;
  active: boolean;
  picked: boolean;
  dropMark: "before" | "after" | null;
  root: RefObject<HTMLDivElement>;
  onDragOver(e: DragEvent, i: number): void;
  onDragEnd(): void;
}

const Thumb = memo(function Thumb({
  doc,
  index,
  size,
  top,
  width,
  active,
  picked,
  dropMark,
  root,
  onDragOver,
  onDragEnd,
}: ThumbProps) {
  const ref = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const scale = width / Math.max(1, size[0]);
  const height = Math.round(size[1] * scale);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setNear(true),
      { root: root.current, rootMargin: "300px 0px" },
    );
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
        if (!isCancelled(e))
          console.warn(`Thumbnail ${index + 1} couldn't be drawn`, e);
      }
    })();
    return () => {
      stopped = true;
      task?.cancel();
    };
  }, [near, doc, index, scale]);

  const click = (e: MouseEvent) => {
    const toggle = isMac() ? e.metaKey : e.ctrlKey;
    useStore
      .getState()
      .pickPage(index, e.shiftKey ? "run" : toggle ? "toggle" : "only");
  };

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      draggable
      className={`thumb${active ? " active" : ""}${picked ? " picked" : ""}${dropMark ? ` drop-${dropMark}` : ""}`}
      data-thumb={index + 1}
      style={{
        top,
        height: height + THUMB_EXTRA,
        width: width + 16,
        left: `calc(50% - ${(width + 16) / 2}px)`,
      }}
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
        e.dataTransfer.setData(
          "text/plain",
          `pages ${dragging.map((p) => p + 1).join(", ")}`,
        );
      }}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
    >
      <div className="thumb-picture" ref={holder} style={{ width, height }} />
      <span className="thumb-number">{index + 1}</span>
    </div>
  );
});

/** The value once it has stopped changing for a moment (the pictures are drawn again only when a drag pauses). */
function useSettled(value: number, ms = 200): number {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
