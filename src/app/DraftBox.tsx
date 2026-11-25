/**
 * Words or a picture sitting on a page before they're written into the PDF:
 * type the words, drag to move, drag the corner to size a picture, then Done.
 * Drawn inside the page, at `scale` CSS pixels per point.
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { cleanSize, keepOnPage, linesOf, LINE_HEIGHT, MAX_WORD_SIZE, MIN_WORD_SIZE, SCREEN_FONT } from "../model/additions";
import { useStore } from "../model/store";
import { FONT_NAMES, type FontChoice } from "../model/watermark";
import { textWidth } from "../pdf/additions";
import { cancelAdding, deleteExisting, finishAdding, replaceExisting, updateDraft } from "./addActions";
import { Icons } from "./icons";
import { ShapeDraft } from "./ShapeDraft";
import { detectPlatform } from "./platform";

const isMac = () => detectPlatform() === "mac";

/** Follow a drag from a pointer press, calling `move` with how far it has gone in points. */
export function dragFrom(e: ReactPointerEvent, scale: number, move: (dx: number, dy: number) => void): void {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const sx = e.clientX;
  const sy = e.clientY;
  const onMove = (ev: PointerEvent) => move((ev.clientX - sx) / scale, (ev.clientY - sy) / scale);
  const onUp = () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}

export function DraftBox({ index, scale }: { index: number; scale: number }) {
  const draft = useStore((s) => (s.draft?.page === index ? s.draft : null));
  const size = useStore((s) => s.pdf?.sizes[index]);
  const area = useRef<HTMLTextAreaElement>(null);

  const isWords = draft?.kind === "words";
  useEffect(() => {
    if (isWords) area.current?.focus();
  }, [isWords]);

  if (!draft || !size) return null;
  const [pw, ph] = size;
  if (draft.kind === "shape") return <ShapeDraft draft={draft} scale={scale} pageW={pw} pageH={ph} />;

  /** Move by (dx, dy) points from where it was when the drag began. */
  const startMove = (e: ReactPointerEvent) => {
    const { x, y } = draft;
    const w = draft.kind === "picture" ? draft.width : boxW;
    const h = draft.kind === "picture" ? draft.height : boxH;
    dragFrom(e, scale, (dx, dy) => updateDraft(keepOnPage(x + dx, y + dy, w, h, pw, ph)));
  };

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelAdding();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void finishAdding();
    }
  };

  let boxW: number;
  let boxH: number;
  let body: React.ReactNode;
  if (draft.kind === "words") {
    const lines = linesOf(draft.text);
    const widest = Math.max(0, ...draft.text.split("\n").map((l) => textWidth(draft.font, l, draft.size)));
    boxW = Math.max(widest + draft.size * 0.6, draft.size * 4);
    boxH = Math.max(1, draft.text.split("\n").length, lines.length) * LINE_HEIGHT * draft.size;
    const font = SCREEN_FONT[draft.font];
    body = (
      <textarea
        ref={area}
        className="draft-words"
        value={draft.text}
        placeholder="Type here"
        aria-label="Words to add"
        spellCheck
        wrap="off"
        onChange={(e) => updateDraft({ text: e.target.value })}
        onKeyDown={keys}
        style={{
          width: boxW * scale,
          height: boxH * scale,
          fontFamily: font.family,
          fontWeight: font.weight,
          fontSize: draft.size * scale,
          lineHeight: LINE_HEIGHT,
          color: draft.colour,
        }}
      />
    );
  } else {
    boxW = draft.width;
    boxH = draft.height;
    const ratio = draft.height / draft.width;
    const startSize = (e: ReactPointerEvent) => {
      const { width, x } = draft;
      dragFrom(e, scale, (dx) => {
        const w = Math.max(12, Math.min(pw * 2, width + dx));
        updateDraft({ width: w, height: w * ratio, x });
      });
    };
    body = (
      <>
        <img
          className="draft-picture"
          src={draft.kind === "existing" ? draft.preview : draft.picture.url}
          alt={draft.kind === "existing" ? "The picture" : draft.picture.name}
          draggable={false} onPointerDown={startMove} style={{ width: boxW * scale, height: boxH * scale }} />
        <span className="draft-size" role="presentation" title="Drag to make the picture bigger or smaller" onPointerDown={startSize} />
      </>
    );
  }

  // What's being changed is hidden (shown as white) where it was, as it will be once it's done.
  const was = draft.kind === "existing" ? draft.from : draft.kind === "words" ? draft.cover : undefined;
  const hole = was && (
    <div className="draft-hole" style={{ left: was.x * scale, top: was.y * scale, width: was.width * scale, height: was.height * scale }} />
  );

  return (
    <>
    {hole}
    <div className={`draft ${draft.kind}`} style={{ left: draft.x * scale, top: draft.y * scale }} onKeyDown={keys} onClick={(e) => e.stopPropagation()}>
      <div className="draft-bar" role="toolbar" aria-label={draft.kind === "words" ? (draft.cover ? "Words to change" : "Words to add") : draft.kind === "existing" ? "Picture to change" : "Picture to add"}>
        <button type="button" className="icon-button small draft-move" onPointerDown={startMove} aria-label="Move" title="Drag to move it">
          <Icons.Move size={15} />
        </button>
        {draft.kind === "words" && (
          <>
            <select aria-label="Font" value={draft.font} onChange={(e) => updateDraft({ font: e.target.value as FontChoice })}>
              {Object.entries(FONT_NAMES).map(([k, name]) => (
                <option key={k} value={k}>
                  {name}
                </option>
              ))}
            </select>
            <input
              type="number"
              aria-label="Letter size"
              title="Letter size, in points"
              min={MIN_WORD_SIZE}
              max={MAX_WORD_SIZE}
              value={draft.size}
              onChange={(e) => e.target.value && updateDraft({ size: cleanSize(Number(e.target.value)) })}
            />
            <input type="color" aria-label="Colour" title="Colour" value={draft.colour} onChange={(e) => updateDraft({ colour: e.target.value })} />
          </>
        )}
        {draft.kind === "existing" && (
          <>
            <button type="button" className="icon-button small" onClick={() => void replaceExisting()} aria-label="Swap the picture" title="Swap it for another picture (PNG or JPG), in the same place">
              <Icons.Picture size={15} />
            </button>
            <button type="button" className="icon-button small" onClick={() => void deleteExisting()} aria-label="Delete the picture" title="Take the picture off the page">
              <Icons.Bin size={15} />
            </button>
          </>
        )}
        <button type="button" className="primary-button draft-done" onClick={() => void finishAdding()} title={`Put it on the page (${isMac() ? "⌘" : "Ctrl"}+Enter)`}>
          Done
        </button>
        <button type="button" className="icon-button small" onClick={cancelAdding} aria-label="Cancel" title="Leave it off (Esc)">
          <Icons.Cross size={15} />
        </button>
      </div>
      {body}
    </div>
    </>
  );
}
