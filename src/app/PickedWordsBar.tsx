/**
 * When words on a page are picked with the mouse, a small bar by them offers
 * to highlight them (or copy them).
 */
import { useEffect, useState } from "react";

import { useStore } from "../model/store";
import { highlightPicked } from "./addActions";
import { Icons } from "./icons";

/** Where to show the bar (window pixels), or null when no words on a page are picked. */
function pickedSpot(): { left: number; top: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return null;
  const range = sel.getRangeAt(0);
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  if (!start?.closest(".page-scroller .textLayer")) return null;
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0 && r.height < window.innerHeight / 3);
  const last = rects[rects.length - 1];
  if (!last) return null;
  return { left: Math.min(window.innerWidth - 270, Math.max(8, last.right - 60)), top: Math.min(window.innerHeight - 44, last.bottom + 8) };
}

export function PickedWordsBar() {
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  const adding = useStore((s) => !!s.placing || !!s.draft);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSpot(pickedSpot()));
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, []);

  if (!spot || adding) return null;
  return (
    <div className="picked-bar" role="toolbar" aria-label="Picked words" style={spot} onMouseDown={(e) => e.preventDefault()}>
      <button type="button" className="picked-button" onClick={() => void highlightPicked()} aria-label="Highlight the picked words" title="Colour in the picked words with see-through yellow">
        <Icons.Highlight size={16} /> Highlight
      </button>
      <button type="button" className="picked-button" onClick={() => void highlightPicked("underline")} aria-label="Underline the picked words" title="Draw a line under the picked words">
        <Icons.Underline size={16} />
      </button>
      <button type="button" className="picked-button" onClick={() => void highlightPicked("crossout")} aria-label="Cross out the picked words" title="Draw a line through the picked words">
        <Icons.CrossOut size={16} />
      </button>
      <button
        type="button"
        className="picked-button"
        onClick={() => {
          const words = window.getSelection()?.toString() ?? "";
          void navigator.clipboard?.writeText(words).then(
            () => useStore.getState().showToast("Copied.", "info"),
            () => useStore.getState().showToast("Couldn't copy: press Ctrl+C instead.", "error"),
          );
        }}
        title="Copy the picked words"
      >
        Copy
      </button>
    </div>
  );
}
