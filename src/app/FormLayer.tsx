/**
 * A page's form boxes, ready to fill in: a light blue tint over each one (as
 * other PDF readers show them), and a real text box, tick or list on top. The
 * page's drawing shows what's filled in; while typing, the words show here,
 * and leaving the box (Tab, Enter, a click elsewhere) writes them into the PDF.
 */
import { memo, useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";

import { dateForBox, fitFontSize, optionLabel, readDate, sameValue, tabOrder, writeDate, type FormBox } from "../model/forms";
import { useStore } from "../model/store";
import type { PDFDocumentProxy } from "../pdf/pdfjs";
import { fillIn, formBoxesOn } from "./formActions";

interface Props {
  doc: PDFDocumentProxy;
  index: number;
  scale: number;
}

export const FormLayer = memo(function FormLayer({ doc, index, scale }: Props) {
  // The boxes from the version last read: kept while the next version's are read, so a box being typed in stays put.
  const [boxes, setBoxes] = useState<FormBox[]>([]);
  const busy = useStore((s) => !!s.placing || !!s.draft);

  useEffect(() => {
    let stopped = false;
    void formBoxesOn(doc, index).then((found) => {
      if (!stopped) setBoxes(tabOrder(found.map((b) => ({ ...b, page: index }))));
    });
    return () => {
      stopped = true;
    };
  }, [doc, index]);

  if (!boxes.length || busy) return null;
  const seen = new Map<string, number>();
  return (
    <div className="form-layer">
      {boxes.map((box) => {
        const n = seen.get(box.name) ?? 0;
        seen.set(box.name, n + 1);
        // Keyed by name (and which of that name), so a box keeps its place, and the typing in it, across versions.
        return <Box key={`${box.kind}:${box.name}#${n}`} box={box} scale={scale} />;
      })}
    </div>
  );
});

function Box({ box, scale }: { box: FormBox; scale: number }) {
  const place: CSSProperties = { left: box.x * scale, top: box.y * scale, width: box.width * scale, height: box.height * scale };
  const tip = `${box.name}${box.readOnly ? " (can't be changed)" : ""}`;
  if (box.kind === "text") return <TextBox box={box} place={place} scale={scale} tip={tip} />;
  if (box.kind === "tick" || box.kind === "radio") return <TickBox box={box} place={place} scale={scale} tip={tip} />;
  return <ListBox box={box} place={place} tip={tip} />;
}

function TextBox({ box, place, scale, tip }: { box: FormBox; place: CSSProperties; scale: number; tip: string }) {
  const saved = String(box.value);
  /** What's typed, while typing and until the PDF shows it. */
  const [typed, setTyped] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // Once the PDF has the words typed, its own drawing shows them.
  useEffect(() => {
    if (!focused && typed !== null && typed === saved) setTyped(null);
  }, [saved, typed, focused]);

  const commit = (typedWords: string) => {
    let words = typedWords;
    if (box.dateFormat) {
      // A date box: whatever date is typed is written the box's way; anything else is turned away.
      const date = dateForBox(words, box.dateFormat);
      if (date === null) {
        useStore.getState().showToast(`That isn't a date. Type one like ${writeDate(2026, 11, 28, box.dateFormat)}, or pick one from the calendar.`, "error");
        setTyped(null);
        return;
      }
      words = date;
    }
    if (words === saved) {
      setTyped(null);
      return;
    }
    void fillIn(box.name, "text", words).then((ok) => {
      if (!ok) setTyped(null);
    });
  };
  const size = fitFontSize(box) * scale;
  const style: CSSProperties = { ...place, fontSize: size, lineHeight: box.multiline ? 1.15 : `${(box.height * scale) - 2}px`, textAlign: box.align === 1 ? "center" : box.align === 2 ? "right" : "left" };
  const props = {
    className: `form-box form-text${typed !== null ? " typing" : ""}`,
    style,
    value: typed ?? saved,
    readOnly: box.readOnly,
    maxLength: box.maxLength,
    title: tip,
    "aria-label": tip,
    spellCheck: false,
    onFocus: () => {
      setFocused(true);
      setTyped((t) => t ?? saved);
    },
    onBlur: (e: { currentTarget: { value: string } }) => {
      setFocused(false);
      if (!box.readOnly) commit(e.currentTarget.value);
    },
    onChange: (e: { currentTarget: { value: string } }) => setTyped(e.currentTarget.value),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // The page's own shortcuts (tools, flipping pages) don't apply while typing.
      e.stopPropagation();
      if (e.key === "Escape") {
        setTyped(saved);
        requestAnimationFrame(() => e.currentTarget?.blur());
      } else if (e.key === "Enter" && !box.multiline) e.currentTarget.blur();
    },
  };
  if (box.multiline) return <textarea {...props} />;
  const dated = !!box.dateFormat && !box.readOnly;
  const side = Math.min(box.height * scale, 22);
  const input = <input type={box.secret ? "password" : "text"} {...props} style={dated ? { ...style, paddingRight: side } : style} />;
  if (!dated || !box.dateFormat) return input;
  // A date box: a calendar to pick from as well.
  const day = readDate(typed ?? saved, box.dateFormat);
  const iso = day ? `${day[0]}-${String(day[1]).padStart(2, "0")}-${String(day[2]).padStart(2, "0")}` : "";
  return (
    <>
      {input}
      <span className="form-date-pick" style={{ left: `calc(${place.left}px + ${place.width}px - ${side}px)`, top: place.top, width: side, height: place.height }} title="Pick a date">
        📅
        <input
          type="date"
          aria-label={`${tip}: pick a date`}
          value={iso}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const got = readDate(e.currentTarget.value, "yyyy-mm-dd");
            if (got) commit(writeDate(got[0], got[1], got[2], box.dateFormat!));
          }}
        />
      </span>
    </>
  );
}

function TickBox({ box, place, scale, tip }: { box: FormBox; place: CSSProperties; scale: number; tip: string }) {
  const on = box.value === true;
  /** Clicked, until the PDF shows it. */
  const [wanted, setWanted] = useState<boolean | null>(null);
  useEffect(() => {
    if (wanted !== null && wanted === on) setWanted(null);
  }, [on, wanted]);
  const radio = box.kind === "radio";
  const toggle = () => {
    if (box.readOnly) return;
    const next = radio ? true : !(wanted ?? on);
    if (next === (wanted ?? on)) return;
    setWanted(next);
    void fillIn(box.name, box.kind, radio ? (box.onValue ?? "") : next).then((ok) => {
      if (!ok) setWanted(null);
    });
  };
  const shown = wanted ?? on;
  return (
    <button
      type="button"
      role={radio ? "radio" : "checkbox"}
      aria-checked={shown}
      aria-label={tip}
      title={tip}
      className={`form-box form-tick${radio ? " round" : ""}${wanted !== null ? " typing" : ""}`}
      style={{ ...place, fontSize: Math.min(box.width, box.height) * scale * 0.8 }}
      onClick={toggle}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {wanted !== null && shown ? (radio ? "●" : "✓") : ""}
    </button>
  );
}

function ListBox({ box, place, tip }: { box: FormBox; place: CSSProperties; tip: string }) {
  const picked = (Array.isArray(box.value) ? box.value : [String(box.value)]).filter((v) => v !== "").map((v) => optionLabel(box, v));
  const [wanted, setWanted] = useState<string[] | null>(null);
  useEffect(() => {
    if (wanted && sameValue(wanted, picked)) setWanted(null);
  }, [picked.join("\n"), wanted]);
  const shown = wanted ?? picked;
  const labels = (box.options ?? []).map((o) => o.label);
  const several = !!box.several;
  return (
    <select
      className={`form-box form-list${wanted ? " typing" : ""}`}
      style={place}
      title={tip}
      aria-label={tip}
      disabled={box.readOnly}
      multiple={several}
      size={box.kind === "list" ? Math.max(2, labels.length) : undefined}
      value={several ? shown : (shown[0] ?? "")}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = Array.from(e.currentTarget.selectedOptions, (o) => o.value).filter((v) => v !== "");
        if (sameValue(next, shown)) return;
        setWanted(next);
        void fillIn(box.name, box.kind, box.kind === "choice" ? (next[0] ?? "") : next).then((ok) => {
          if (!ok) setWanted(null);
        });
      }}
    >
      {box.kind === "choice" && !labels.includes("") && <option value="">—</option>}
      {labels.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}
