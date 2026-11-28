/**
 * A form box (a box to type in, a tick box, a list to choose from, a round
 * button of a set to pick one from, or a date box) on a page
 * before it's written into the PDF's form: drag it to move it, its corner to
 * size it, name it, then Done. Whoever opens the PDF in Acrobat, Preview or
 * another reader can then fill it in.
 */
import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { choicesOf, FIELD_NAMES, hasChoices, keepOnPage, squareField, type FieldItem, type FieldKind } from "../model/additions";
import { DATE_FORMATS, writeDate } from "../model/forms";
import { cancelAdding, finishAdding, markDraft, setFieldKind, updateDraft } from "./addActions";
import { dragFrom } from "./DraftBox";
import { KeptButtons } from "./DraftControls";
import { Icons } from "./icons";

const SIZES = [0, 8, 9, 10, 11, 12, 14, 16, 18, 24];

export function FieldDraft({ draft, scale, pageW, pageH }: { draft: FieldItem; scale: number; pageW: number; pageH: number }) {
  const s = (v: number) => v * scale;
  const [choiceText, setChoiceText] = useState((draft.choices ?? []).join("\n"));

  const startMove = (e: ReactPointerEvent) => {
    const { x, y, width, height } = draft;
    dragFrom(e, scale, (dx, dy) => updateDraft(keepOnPage(x + dx, y + dy, width, height, pageW, pageH)));
  };
  const startSize = (e: ReactPointerEvent) => {
    const { width, height } = draft;
    dragFrom(e, scale, (dx, dy) => {
      if (squareField(draft.field)) {
        const side = Math.max(8, Math.min(72, width + Math.max(dx, dy)));
        updateDraft({ width: side, height: side });
      } else updateDraft({ width: Math.max(12, Math.min(pageW, width + dx)), height: Math.max(10, Math.min(pageH, height + dy)) });
    });
  };

  const name = FIELD_NAMES[draft.field].toLowerCase();
  return (
    <div className="draft field" style={{ left: s(draft.x), top: s(draft.y) }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="draft-bar" role="toolbar" aria-label="Form box">
        <select aria-label="Kind of form box" value={draft.field} onChange={(e) => setFieldKind(e.target.value as FieldKind)}>
          {Object.entries(FIELD_NAMES).map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
        </select>
        <input
          className="field-name"
          aria-label={draft.field === "round" ? "Set" : "Name"}
          title={
            draft.field === "round"
              ? "The set it belongs to: round buttons with the same set name go together, and only one of them can be picked"
              : "Its name in the form (some readers show it to whoever fills it in)"
          }
          value={draft.name}
          onFocus={markDraft}
          onChange={(e) => updateDraft({ name: e.target.value })}
        />
        {draft.field === "round" && (
          <input
            className="field-name"
            aria-label="Means"
            title="What picking this button means, e.g. “Yes” or “Large” (each button in a set means something different)"
            value={draft.option ?? ""}
            onFocus={markDraft}
            onChange={(e) => updateDraft({ option: e.target.value })}
          />
        )}
        {draft.field === "date" && (
          <select aria-label="How dates are written" title="How the date is written in the box" value={draft.dateFormat ?? DATE_FORMATS[0]} onChange={(e) => updateDraft({ dateFormat: e.target.value }, true)}>
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {writeDate(2026, 11, 28, f)}
              </option>
            ))}
          </select>
        )}
        {draft.field === "text" && (
          <>
            <label className="field-check" title="Let several lines be typed in it">
              <input type="checkbox" checked={!!draft.multiline} onChange={(e) => updateDraft({ multiline: e.target.checked }, true)} /> Several lines
            </label>
            <select aria-label="Letter size" title="The size of the letters typed in it" value={draft.size ?? 0} onChange={(e) => updateDraft({ size: Number(e.target.value) }, true)}>
              {SIZES.map((v) => (
                <option key={v} value={v}>
                  {v ? `${v} pt` : "Fit the box"}
                </option>
              ))}
            </select>
          </>
        )}
        {draft.field === "list" && (
          <label className="field-check" title="Let whoever fills it in pick more than one choice">
            <input type="checkbox" checked={!!draft.several} onChange={(e) => updateDraft({ several: e.target.checked }, true)} /> Pick several
          </label>
        )}
        <label className="field-check" title="Whoever fills in the form must fill this in: readers remind them if it's left empty">
          <input type="checkbox" checked={!!draft.required} onChange={(e) => updateDraft({ required: e.target.checked }, true)} /> Must be filled in
        </label>
        {draft.id !== undefined && <KeptButtons name={name} />}
        <button type="button" className="primary-button draft-done" onClick={() => void finishAdding()} title={`Put the ${name} on the page (Enter)`}>
          Done
        </button>
        <button type="button" className="icon-button small" onClick={cancelAdding} aria-label="Cancel" title={`Leave the ${name} off (Esc)`}>
          <Icons.Cross size={15} />
        </button>
      </div>
      <div className={`field-box ${draft.field}`} style={{ width: s(draft.width), height: s(draft.height), fontSize: Math.max(8, Math.min(s(draft.height) * 0.6, 16)) }} onPointerDown={startMove} title="Drag to move it">
        {draft.field === "tick" ? (
          <Icons.Tick size={Math.max(8, s(draft.height) * 0.8)} />
        ) : draft.field === "round" ? null : draft.field === "list" ? (
          <span className="field-list" style={{ fontSize: s(10) }}>
            {(draft.choices ?? []).map((c) => (
              <span key={c}>{c}</span>
            ))}
          </span>
        ) : (
          <span>{draft.field === "choice" ? `${draft.choices?.[0] ?? ""} ▾` : draft.field === "date" ? (draft.dateFormat ?? DATE_FORMATS[0]) : draft.name}</span>
        )}
        <span className="draft-size" role="presentation" title="Drag to make it bigger or smaller" onPointerDown={startSize} />
      </div>
      {hasChoices(draft.field) && (
        <label className="field-choices">
          <span>Choices, one to a line</span>
          <textarea
            aria-label="Choices"
            rows={Math.min(8, Math.max(3, choiceText.split("\n").length + 1))}
            value={choiceText}
            onFocus={markDraft}
            onChange={(e) => {
              setChoiceText(e.target.value);
              updateDraft({ choices: choicesOf(e.target.value) });
            }}
          />
        </label>
      )}
    </div>
  );
}
