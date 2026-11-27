/**
 * A pen drawing on a page before it's written into the PDF: drawn stroke by
 * stroke while the pen is on, or (one already on the page, picked to change)
 * moved by dragging it and sized by its corner. Pick a colour, thickness and
 * how see-through, then Done.
 */
import type { PointerEvent as ReactPointerEvent } from "react";

import { fitInk, inkBox, opacityOf, strokePath, type InkItem } from "../model/additions";
import { useStore } from "../model/store";
import { cancelAdding, finishAdding, moveDraftTo, updateDraft } from "./addActions";
import { dragFrom } from "./DraftBox";
import { ColourButton, KeptButtons, SeeThrough, Thickness } from "./DraftControls";
import { Icons } from "./icons";

export function InkDraft({ draft, scale, pageW, pageH }: { draft: InkItem; scale: number; pageW: number; pageH: number }) {
  const drawing = useStore((s) => s.placing?.kind === "ink");
  const box = inkBox(draft);
  const s = (v: number) => v * scale;

  const startMove = (e: ReactPointerEvent) => {
    const start = draft;
    dragFrom(e, scale, (dx, dy) => {
      const mx = Math.min(pageW - box.x - box.width, Math.max(-box.x, dx));
      const my = Math.min(pageH - box.y - box.height, Math.max(-box.y, dy));
      moveDraftTo(start, mx, my);
    });
  };
  const startSize = (e: ReactPointerEvent) => {
    const start = draft;
    const from = inkBox({ ...draft, thickness: 0 });
    const ratio = from.height / Math.max(from.width, 0.1);
    dragFrom(e, scale, (dx) => {
      const width = Math.max(6, from.width + dx);
      updateDraft({ strokes: fitInk(start, from, { x: from.x, y: from.y, width, height: width * ratio }).strokes });
    });
  };

  return (
    <div className="draft shape" style={{ left: 0, top: 0 }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <svg className="shape-draft" width={s(pageW)} height={s(pageH)} aria-hidden="true">
        <g opacity={opacityOf(draft)} fill="none" stroke={draft.colour} strokeWidth={s(draft.thickness)} strokeLinecap="round" strokeLinejoin="round">
          {draft.strokes.map((st, i) => (
            <path key={i} d={strokePath(st, scale)} />
          ))}
        </g>
        {!drawing && draft.strokes.length > 0 && (
          <>
            <rect x={s(box.x)} y={s(box.y)} width={s(box.width)} height={s(box.height)} className="shape-grab fill" onPointerDown={startMove} />
            <circle cx={s(box.x + box.width)} cy={s(box.y + box.height)} r={6} className="shape-handle size" onPointerDown={startSize} />
          </>
        )}
      </svg>
      <div className="draft-bar" role="toolbar" aria-label="Drawing" style={{ left: s(box.x) - 2, top: s(box.y) - 6, bottom: "auto", transform: "translateY(-100%)" }}>
        <ColourButton label="Colour" value={draft.colour} onChange={(c) => c && updateDraft({ colour: c })} />
        <Thickness value={draft.thickness} />
        <SeeThrough value={draft.seeThrough ?? 0} onChange={(v) => updateDraft({ seeThrough: v })} />
        {draft.id !== undefined && <KeptButtons name="drawing" />}
        <button type="button" className="primary-button draft-done" onClick={() => void finishAdding()} title="Put the drawing on the page (Enter)">
          Done
        </button>
        <button type="button" className="icon-button small" onClick={cancelAdding} aria-label="Cancel" title="Leave the drawing off (Esc)">
          <Icons.Cross size={15} />
        </button>
      </div>
    </div>
  );
}
