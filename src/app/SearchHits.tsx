/**
 * The places the search bar found on one page, coloured in: see-through
 * yellow, and orange for the one being shown. Drawn under the page's words
 * layer (so words can still be picked) from where those words' letters are,
 * kept as shares of the page's width and height so they follow the zoom.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { hitsOnPage } from "../model/search";
import { useStore } from "../model/store";
import { scrollToHit } from "./searchActions";

interface Spot {
  hit: number;
  boxes: { left: number; top: number; width: number; height: number }[];
}

export function SearchHits({ index, spans }: { index: number; spans: HTMLElement[] | null }) {
  const hits = useStore((s) => s.search?.hits ?? null);
  const current = useStore((s) => s.search?.current ?? -1);
  const scrollTo = useStore((s) => s.search?.scrollTo ?? null);
  const layer = useRef<HTMLDivElement>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [first, end] = useMemo(() => (hits ? hitsOnPage(hits, index) : [0, 0]), [hits, index]);
  // Only worked out again when this page's own hits change, not every time more are found elsewhere.
  const mine = useMemo(() => (hits ? hits.slice(first, end) : []), [hits, first, end]);
  const key = useMemo(() => `${first}:${JSON.stringify(mine.map((h) => h.pieces))}`, [first, mine]);

  useLayoutEffect(() => {
    const el = layer.current;
    if (!el || !spans || !mine.length) {
      setSpots((s) => (s.length ? [] : s));
      return;
    }
    const page = el.getBoundingClientRect();
    if (page.width <= 0 || page.height <= 0) return;
    const range = document.createRange();
    const out: Spot[] = mine.map((hit, k) => {
      const boxes: Spot["boxes"] = [];
      for (const piece of hit.pieces) {
        const text = spans[piece.bit]?.firstChild;
        if (!text || text.nodeType !== Node.TEXT_NODE) continue;
        const length = text.textContent?.length ?? 0;
        range.setStart(text, Math.min(piece.from, length));
        range.setEnd(text, Math.min(piece.to, length));
        for (const r of range.getClientRects()) {
          if (r.width <= 0 || r.height <= 0) continue;
          boxes.push({ left: (r.left - page.left) / page.width, top: (r.top - page.top) / page.height, width: r.width / page.width, height: r.height / page.height });
        }
      }
      return { hit: first + k, boxes };
    });
    setSpots(out);
  }, [spans, key]);

  // Asked to show a place on this page before it was drawn: scroll to it now it is.
  useEffect(() => {
    if (scrollTo === null || scrollTo < first || scrollTo >= end) return;
    const el = layer.current?.querySelector<HTMLElement>(`.search-hit[data-hit="${scrollTo}"]`);
    if (!el) return;
    scrollToHit(el);
    const s = useStore.getState();
    if (s.search) s.setSearch({ ...s.search, scrollTo: null });
  }, [scrollTo, spots, first, end]);

  return (
    <div className="search-hits" ref={layer} aria-hidden="true">
      {spots.map((spot) =>
        spot.boxes.map((b, k) => (
          <div
            key={`${spot.hit}-${k}`}
            className={`search-hit${spot.hit === current ? " current" : ""}`}
            data-hit={spot.hit}
            style={{ left: `${b.left * 100}%`, top: `${b.top * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` }}
          />
        )),
      )}
    </div>
  );
}
