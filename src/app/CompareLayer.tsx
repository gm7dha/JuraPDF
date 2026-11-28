/**
 * The differences found by comparing, coloured in on a page: new words green,
 * changed ones amber, a red bar where words were taken out. They let clicks
 * through, so the words under them can still be picked.
 */
import { memo, useEffect, useRef } from "react";

import { scrollToHit } from "./searchActions";

import type { PlaceBox } from "../model/compare";
import { useStore } from "../model/store";

export const CompareLayer = memo(function CompareLayer({ index, scale }: { index: number; scale: number }) {
  const c = useStore((s) => (s.compare && s.compare.forDoc === s.pdf?.doc && !s.compare.progress ? s.compare : null));
  const current = useRef<HTMLDivElement>(null);
  const scrollTo = !!c?.scrollTo;
  const currentIndex = c?.current ?? -1;

  // Bring the difference just picked into view (once its page is here), once.
  useEffect(() => {
    if (!scrollTo || !current.current) return;
    scrollToHit(current.current);
    const now = useStore.getState().compare;
    if (now) useStore.getState().setCompare({ ...now, scrollTo: false });
  }, [scrollTo, currentIndex]);

  if (!c?.changes?.length) return null;
  const here: { i: number; kind: string; box: PlaceBox; first: boolean }[] = [];
  c.places.forEach((boxes, i) => {
    let first = true;
    for (const box of boxes) {
      if (box.page !== index) continue;
      here.push({ i, kind: c.changes![i].kind, box, first });
      first = false;
    }
  });
  if (!here.length) return null;
  return (
    <div className="compare-layer">
      {here.map(({ i, kind, box, first }, k) => (
        <div
          key={k}
          ref={first && i === currentIndex ? current : undefined}
          className={`compare-mark ${kind}${i === currentIndex ? " current" : ""}`}
          style={{
            left: box.x * scale,
            top: box.y * scale,
            width: Math.max(2, box.width * scale),
            height: box.height * scale,
            ...(box.turn ? { transform: `rotate(${box.turn}deg)`, transformOrigin: "0 100%" } : {}),
          }}
        />
      ))}
    </div>
  );
});
