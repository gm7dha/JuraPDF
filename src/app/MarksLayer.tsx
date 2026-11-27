/** The places on a page marked to black out (not done yet): striped boxes, each with a × to unmark it. */
import { memo } from "react";

import { useStore } from "../model/store";
import { removeMark } from "./redactActions";

export const MarksLayer = memo(function MarksLayer({ index, scale }: { index: number; scale: number }) {
  const marks = useStore((s) => s.marks);
  const draft = useStore((s) => (s.markDraft?.page === index ? s.markDraft : null));
  const here = marks.map((m, i) => ({ m, i })).filter(({ m }) => m.page === index);
  if (!here.length && !draft) return null;
  const place = (m: { x: number; y: number; width: number; height: number }) => ({ left: m.x * scale, top: m.y * scale, width: m.width * scale, height: m.height * scale });
  return (
    <div className="marks-layer">
      {here.map(({ m, i }) => (
        <div key={i} className="black-mark" style={place(m)} title="To be blacked out">
          <button
            type="button"
            className="black-mark-x"
            aria-label="Don't black this out"
            title="Don't black this out"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              removeMark(i);
            }}
          >
            ×
          </button>
        </div>
      ))}
      {draft && <div className="black-mark drawing" style={place(draft)} />}
    </div>
  );
});
