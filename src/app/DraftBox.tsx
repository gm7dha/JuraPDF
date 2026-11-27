/**
 * Words or a picture sitting on a page before they're written into the PDF:
 * type the words, drag to move, drag the corner to size a picture, then Done.
 * Drawn inside the page, at `scale` CSS pixels per point.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { cleanSize, keepOnPage, linesOf, LINE_HEIGHT, MAX_WORD_SIZE, MIN_WORD_SIZE, SCREEN_FONT, SWATCHES, type OwnFont, type WordsItem } from "../model/additions";
import { missingLetters } from "../model/fontCodes";
import { useStore } from "../model/store";
import { FONT_NAMES, type FontChoice } from "../model/watermark";
import { textWidth } from "../pdf/additions";
import { fontLetters } from "../pdf/fonts";
import { pageWithout } from "../pdf/items";
import { drawPage, loadPdf, type PDFDocumentProxy } from "../pdf/pdfjs";
import { cancelAdding, deleteExisting, finishAdding, markDraft, noteDragEnd, replaceExisting, updateDraft } from "./addActions";
import { ColourButton, KeptButtons } from "./DraftControls";
import { Icons } from "./icons";
import { InkDraft } from "./InkDraft";
import { ShapeDraft } from "./ShapeDraft";
import { detectPlatform } from "./platform";

const isMac = () => detectPlatform() === "mac";

/** Follow a drag from a pointer press, calling `move` with how far it has gone in points. (Ctrl+Z goes back to before the drag.) */
export function dragFrom(e: ReactPointerEvent, scale: number, move: (dx: number, dy: number) => void): void {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  markDraft();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const sx = e.clientX;
  const sy = e.clientY;
  const onMove = (ev: PointerEvent) => move((ev.clientX - sx) / scale, (ev.clientY - sy) / scale);
  const onUp = () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    noteDragEnd();
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
  // Something already on the page being changed: the page shows without it underneath, so it isn't seen twice.
  const under = draft.kind !== "existing" && draft.id !== undefined ? <Underneath page={index} id={draft.id} scale={scale} /> : null;
  if (draft.kind === "shape")
    return (
      <>
        {under}
        <ShapeDraft draft={draft} scale={scale} pageW={pw} pageH={ph} />
      </>
    );
  if (draft.kind === "ink")
    return (
      <>
        {under}
        <InkDraft draft={draft} scale={scale} pageW={pw} pageH={ph} />
      </>
    );

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
    const font = SCREEN_FONT[draft.font];
    const family = draft.own?.screen ? `"${draft.own.screen}", ${font.family}` : font.family;
    const widest = Math.max(0, ...draft.text.split("\n").map((l) => (draft.own?.screen ? measure(l, draft.size, family, font.weight, font.style) : textWidth(draft.font, l, draft.size))));
    boxW = Math.max(widest + draft.size * 0.6, draft.size * 4);
    boxH = Math.max(1, draft.text.split("\n").length, lines.length) * LINE_HEIGHT * draft.size;
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
          fontFamily: family,
          fontWeight: draft.own?.screen ? undefined : font.weight,
          fontStyle: draft.own?.screen ? undefined : font.style,
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
          src={draft.kind === "existing" ? draft.preview : (draft.picture?.url ?? draft.preview)}
          alt={draft.kind === "existing" || !draft.picture ? "The picture" : draft.picture.name}
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
    {under}
    {hole}
    <div className={`draft ${draft.kind}`} style={{ left: draft.x * scale, top: draft.y * scale }} onKeyDown={keys} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="draft-bar" role="toolbar" aria-label={draft.kind === "words" ? (draft.cover ? "Words to change" : "Words to add") : draft.kind === "existing" ? "Picture to change" : "Picture to add"}>
        <button type="button" className="icon-button small draft-move" onPointerDown={startMove} aria-label="Move" title="Drag to move it">
          <Icons.Move size={15} />
        </button>
        {draft.kind === "words" && <WordsControls draft={draft} />}
        {draft.kind === "picture" && draft.id !== undefined && <KeptButtons name="picture" />}
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

let measurer: CanvasRenderingContext2D | null = null;
/** How wide words are in a browser font, in points (for the PDF's own fonts, which pdf.js loaded into the browser). */
function measure(text: string, size: number, family: string, weight: number, style: string): number {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return text.length * size * 0.55;
  measurer.font = `${style} ${weight} 100px ${family}`;
  return (measurer.measureText(text).width / 100) * size;
}

/** The font, size and colour of words being typed, and (for words already on the page) Copy and Delete. */
function WordsControls({ draft }: { draft: WordsItem }) {
  // The PDF's own font stays offered after another is picked, so it can be picked again.
  const ownSeen = useRef<OwnFont | undefined>(draft.own);
  if (draft.own) ownSeen.current = draft.own;
  const own = ownSeen.current;
  const bytes = useStore((s) => s.pdf?.bytes);
  const [letters, setLetters] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!own || !bytes) return;
    let stop = false;
    void fontLetters(bytes, draft.page, own.base).then((l) => !stop && setLetters(l), () => !stop && setLetters(null));
    return () => {
      stop = true;
    };
  }, [own?.base, bytes, draft.page]);
  const missing = draft.own && letters ? missingLetters(new Map([...letters].map((l) => [l, ""])), draft.text) : draft.own && !letters ? "?" : "";
  return (
    <>
      <select
        aria-label="Font"
        value={draft.own ? "own" : draft.font}
        onChange={(e) => (e.target.value === "own" ? updateDraft({ own }, true) : updateDraft({ font: e.target.value as FontChoice, own: undefined }, true))}
      >
        {own && <option value="own">{own.label} (this PDF's own)</option>}
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
        step="any"
        value={draft.size}
        onFocus={markDraft}
        onChange={(e) => e.target.value && updateDraft({ size: cleanSize(Number(e.target.value)) })}
      />
      <ColourButton label="Colour of the words" value={draft.colour} swatches={SWATCHES} onChange={(c) => c && updateDraft({ colour: c })} />
      {draft.id !== undefined && <KeptButtons name="words" />}
      {missing && (
        <span className="draft-note" role="note" title={missing === "?" ? "" : `Not in ${own?.label}: ${missing}`}>
          {missing === "?" ? `Close match: ${FONT_NAMES[draft.font]}` : `Some letters aren't in ${own?.label}: ${FONT_NAMES[draft.font]} will be used`}
        </span>
      )}
    </>
  );
}

/** The page as it would be without the thing being changed, drawn over the page while it's changed. */
function Underneath({ page, id, scale }: { page: number; id: number; scale: number }) {
  const bytes = useStore((s) => s.pdf?.bytes);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bytes) return;
    let stop = false;
    let doc: PDFDocumentProxy | null = null;
    void (async () => {
      try {
        const one = await pageWithout(bytes, page, id);
        if (!one || stop) return;
        doc = await loadPdf(one);
        const p = await doc.getPage(1);
        const canvas = document.createElement("canvas");
        await drawPage(p, canvas, scale).promise;
        if (!stop) holder.current?.replaceChildren(canvas);
      } catch {
        // The page shows as it is; the thing being changed just shows twice meanwhile.
      }
    })();
    return () => {
      stop = true;
      void doc?.destroy();
    };
  }, [bytes, page, id, scale]);
  return <div className="draft-under" ref={holder} aria-hidden="true" />;
}
