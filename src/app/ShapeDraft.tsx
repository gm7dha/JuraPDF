/**
 * A highlight, box, oval, line or arrow sitting on a page before it's written
 * into the PDF: drag its round handles to change it, drag the shape to move
 * it, pick a colour and thickness, then Done. Drawn inside the page, at
 * `scale` CSS pixels per point.
 */
import type { PointerEvent as ReactPointerEvent } from "react";

import { arrowHead, HIGHLIGHT_OPACITY, SHAPE_NAMES, shapeBox, type ShapeItem } from "../model/additions";
import { cancelAdding, finishAdding, updateDraft } from "./addActions";
import { dragFrom } from "./DraftBox";
import { Icons } from "./icons";

const MIN_THICKNESS = 0.5;
const MAX_THICKNESS = 20;

export function ShapeDraft({ draft, scale, pageW, pageH }: { draft: ShapeItem; scale: number; pageW: number; pageH: number }) {
  const s = (v: number) => v * scale;
  const clampX = (v: number) => Math.min(pageW, Math.max(0, v));
  const clampY = (v: number) => Math.min(pageH, Math.max(0, v));
  const box = shapeBox(draft);
  const isLine = draft.shape === "line" || draft.shape === "arrow";
  const width = Math.max(draft.thickness, 0.5);

  /** Drag the whole shape, keeping it on the page. */
  const startMove = (e: ReactPointerEvent) => {
    const { x1, y1, x2, y2 } = draft;
    dragFrom(e, scale, (dx, dy) => {
      const mx = Math.min(pageW - box.x - box.width, Math.max(-box.x, dx));
      const my = Math.min(pageH - box.y - box.height, Math.max(-box.y, dy));
      updateDraft({ x1: x1 + mx, y1: y1 + my, x2: x2 + mx, y2: y2 + my });
    });
  };

  /** Drag one end (or corner). */
  const startEnd = (end: 1 | 2) => (e: ReactPointerEvent) => {
    const x = end === 1 ? draft.x1 : draft.x2;
    const y = end === 1 ? draft.y1 : draft.y2;
    dragFrom(e, scale, (dx, dy) => {
      const nx = clampX(x + dx);
      const ny = clampY(y + dy);
      updateDraft(end === 1 ? { x1: nx, y1: ny } : { x2: nx, y2: ny });
    });
  };

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelAdding();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void finishAdding();
    }
  };

  let drawing: React.ReactNode;
  if (draft.shape === "highlight") {
    drawing = <rect x={s(box.x)} y={s(box.y)} width={s(box.width)} height={s(box.height)} fill={draft.colour} opacity={HIGHLIGHT_OPACITY} className="shape-highlight" />;
  } else if (draft.shape === "box") {
    drawing = <rect x={s(box.x + width / 2)} y={s(box.y + width / 2)} width={s(Math.max(0, box.width - width))} height={s(Math.max(0, box.height - width))} fill="none" stroke={draft.colour} strokeWidth={s(width)} />;
  } else if (draft.shape === "oval") {
    drawing = (
      <ellipse
        cx={s(box.x + box.width / 2)}
        cy={s(box.y + box.height / 2)}
        rx={s(Math.max(0, box.width - width) / 2)}
        ry={s(Math.max(0, box.height - width) / 2)}
        fill="none"
        stroke={draft.colour}
        strokeWidth={s(width)}
      />
    );
  } else {
    const head = draft.shape === "arrow" ? arrowHead(draft) : null;
    const end = head ? [(head[1][0] + head[2][0]) / 2, (head[1][1] + head[2][1]) / 2] : [draft.x2, draft.y2];
    drawing = (
      <>
        <line x1={s(draft.x1)} y1={s(draft.y1)} x2={s(end[0])} y2={s(end[1])} stroke={draft.colour} strokeWidth={s(width)} strokeLinecap="round" />
        {head && <polygon points={head.map(([x, y]) => `${s(x)},${s(y)}`).join(" ")} fill={draft.colour} />}
      </>
    );
  }

  // Something wide and invisible to grab the shape by.
  const grab = isLine ? (
    <line x1={s(draft.x1)} y1={s(draft.y1)} x2={s(draft.x2)} y2={s(draft.y2)} className="shape-grab" strokeWidth={Math.max(14, s(width) + 8)} onPointerDown={startMove} />
  ) : (
    <rect x={s(box.x)} y={s(box.y)} width={s(box.width)} height={s(box.height)} className="shape-grab fill" onPointerDown={startMove} />
  );

  const name = SHAPE_NAMES[draft.shape].toLowerCase();
  const barTop = Math.min(draft.y1, draft.y2);
  return (
    <div className="draft shape" style={{ left: 0, top: 0 }} onKeyDown={keys} onClick={(e) => e.stopPropagation()}>
      <svg className="shape-draft" width={s(pageW)} height={s(pageH)} aria-hidden="true">
        {drawing}
        {grab}
        <circle cx={s(draft.x1)} cy={s(draft.y1)} r={6} className="shape-handle" onPointerDown={startEnd(1)} />
        <circle cx={s(draft.x2)} cy={s(draft.y2)} r={6} className="shape-handle" onPointerDown={startEnd(2)} />
      </svg>
      <div className="draft-bar" role="toolbar" aria-label={`${SHAPE_NAMES[draft.shape]} to add`} style={{ left: s(box.x) - 2, top: s(barTop) - 6, bottom: "auto", transform: "translateY(-100%)" }}>
        <input type="color" aria-label="Colour" title="Colour" value={draft.colour} onChange={(e) => updateDraft({ colour: e.target.value })} />
        {draft.shape !== "highlight" && (
          <input
            type="number"
            aria-label="Thickness"
            title="How thick the lines are, in points"
            min={MIN_THICKNESS}
            max={MAX_THICKNESS}
            step={0.5}
            value={draft.thickness}
            onChange={(e) => e.target.value && updateDraft({ thickness: Math.min(MAX_THICKNESS, Math.max(MIN_THICKNESS, Number(e.target.value) || 2)) })}
          />
        )}
        <button type="button" className="primary-button draft-done" onClick={() => void finishAdding()} title={`Put the ${name} on the page (Enter)`}>
          Done
        </button>
        <button type="button" className="icon-button small" onClick={cancelAdding} aria-label="Cancel" title={`Leave the ${name} off (Esc)`}>
          <Icons.Cross size={15} />
        </button>
      </div>
    </div>
  );
}

