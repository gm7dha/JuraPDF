/**
 * A highlight, box, oval, line or arrow sitting on a page before it's written
 * into the PDF: drag its round handles to change it, drag the shape to move
 * it, pick a colour and thickness, then Done. Drawn inside the page, at
 * `scale` CSS pixels per point.
 */
import type { PointerEvent as ReactPointerEvent } from "react";

import { arrowHead, canFill, HIGHLIGHT_SWATCHES, opacityOf, SHAPE_NAMES, shapeBox, type ShapeItem } from "../model/additions";
import { cancelAdding, finishAdding, updateDraft } from "./addActions";
import { dragFrom } from "./DraftBox";
import { ColourButton, KeptButtons, SeeThrough, Thickness } from "./DraftControls";
import { Icons } from "./icons";

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

  /** Drag a corner (or an end): `xs` and `ys` say which of the two x's and y's it moves. */
  const startCorner = (xs: "x1" | "x2", ys: "y1" | "y2") => (e: ReactPointerEvent) => {
    const x = draft[xs];
    const y = draft[ys];
    dragFrom(e, scale, (dx, dy) => updateDraft({ [xs]: clampX(x + dx), [ys]: clampY(y + dy) }));
  };
  const corners: ["x1" | "x2", "y1" | "y2"][] = isLine
    ? [
        ["x1", "y1"],
        ["x2", "y2"],
      ]
    : [
        ["x1", "y1"],
        ["x2", "y1"],
        ["x1", "y2"],
        ["x2", "y2"],
      ];

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

  const opacity = opacityOf(draft);
  const fill = draft.fill && canFill(draft.shape) ? draft.fill : "none";
  let drawing: React.ReactNode;
  if (draft.shape === "highlight") {
    drawing = <rect x={s(box.x)} y={s(box.y)} width={s(box.width)} height={s(box.height)} fill={draft.colour} opacity={opacity} className="shape-highlight" />;
  } else if (draft.shape === "box") {
    // As the PDF draws it: the line runs along the edge of the box dragged out, half inside it and half out.
    drawing = <rect x={s(box.x)} y={s(box.y)} width={s(box.width)} height={s(box.height)} fill={fill} stroke={draft.colour} strokeWidth={s(width)} opacity={opacity} />;
  } else if (draft.shape === "oval") {
    drawing = (
      <ellipse
        cx={s(box.x + box.width / 2)}
        cy={s(box.y + box.height / 2)}
        rx={s(box.width / 2)}
        ry={s(box.height / 2)}
        fill={fill}
        stroke={draft.colour}
        strokeWidth={s(width)}
        opacity={opacity}
      />
    );
  } else {
    const head = draft.shape === "arrow" ? arrowHead(draft) : null;
    const end = head ? [(head[1][0] + head[2][0]) / 2, (head[1][1] + head[2][1]) / 2] : [draft.x2, draft.y2];
    drawing = (
      <g opacity={opacity}>
        <line x1={s(draft.x1)} y1={s(draft.y1)} x2={s(end[0])} y2={s(end[1])} stroke={draft.colour} strokeWidth={s(width)} strokeLinecap="round" />
        {head && <polygon points={head.map(([x, y]) => `${s(x)},${s(y)}`).join(" ")} fill={draft.colour} />}
      </g>
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
    <div className="draft shape" style={{ left: 0, top: 0 }} onKeyDown={keys} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <svg className="shape-draft" width={s(pageW)} height={s(pageH)} aria-hidden="true">
        {drawing}
        {grab}
        {corners.map(([xs, ys]) => (
          <circle key={xs + ys} cx={s(draft[xs])} cy={s(draft[ys])} r={6} className="shape-handle" onPointerDown={startCorner(xs, ys)} />
        ))}
      </svg>
      <div className="draft-bar" role="toolbar" aria-label={`${SHAPE_NAMES[draft.shape]} to add`} style={{ left: s(box.x) - 2, top: s(barTop) - 6, bottom: "auto", transform: "translateY(-100%)" }}>
        <ColourButton
          label={draft.shape === "highlight" ? "Colour" : "Line colour"}
          value={draft.colour}
          swatches={draft.shape === "highlight" ? HIGHLIGHT_SWATCHES : undefined}
          onChange={(c) => c && updateDraft({ colour: c })}
        />
        {canFill(draft.shape) && <ColourButton label="Fill colour (inside)" value={draft.fill ?? null} allowNone onChange={(c) => updateDraft({ fill: c })} />}
        {draft.shape !== "highlight" && <Thickness value={draft.thickness} />}
        {draft.shape !== "highlight" && <SeeThrough value={draft.seeThrough ?? 0} onChange={(v) => updateDraft({ seeThrough: v })} />}
        {draft.id !== undefined && <KeptButtons name={name} />}
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

