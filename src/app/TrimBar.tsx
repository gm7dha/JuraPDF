/** While trimming pages: what will be trimmed, which pages, and the buttons to trim, show whole pages again or stop. */
import { useState } from "react";

import { useStore } from "../model/store";
import { marginsFor, marginsLabel } from "../model/trim";
import { Icons } from "./icons";
import { stopTrimming, trimChosen, untrimChosen, type TrimWhich } from "./trimActions";

export function TrimBar() {
  const trimming = useStore((s) => s.placing?.kind === "trim");
  const box = useStore((s) => s.trimBox);
  const size = useStore((s) => (s.trimBox ? s.pdf?.sizes[s.trimBox.page] : undefined));
  const picked = useStore((s) => s.selected.length);
  const [which, setWhich] = useState<TrimWhich>("this");
  if (!trimming) return null;
  const choices: [TrimWhich, string][] = [
    ["this", box ? `Page ${box.page + 1}` : "This page"],
    ["all", "All pages"],
    ...(picked > 1 ? [["picked", `Picked pages (${picked})`] as [TrimWhich, string]] : []),
  ];
  const chosen = which === "picked" && picked < 2 ? "this" : which;
  return (
    <div className="redact-bar trim-bar" role="toolbar" aria-label="Trim pages">
      <Icons.Trim size={16} />
      <span className="redact-count">{box && size ? `Trim ${marginsLabel(marginsFor(box, size[0], size[1]))}` : "Drag a box round the part to keep"}</span>
      <div className={`segmented ${choices.length === 3 ? "three" : "two"} trim-which`} role="radiogroup" aria-label="Which pages">
        {choices.map(([w, label]) => (
          <button type="button" key={w} role="radio" aria-checked={chosen === w} className={chosen === w ? "selected" : ""} onClick={() => setWhich(w)}>
            {label}
          </button>
        ))}
      </div>
      <button type="button" className="text-button" onClick={() => void untrimChosen(chosen)} title="Bring back the trimmed edges of these pages, showing all of the paper">
        Show whole pages
      </button>
      <button type="button" className="text-button" onClick={stopTrimming}>
        Cancel
      </button>
      <button type="button" className="primary-button" disabled={!box} onClick={() => void trimChosen(chosen)} title="Trim the edges outside the box off these pages (Undo puts them back)">
        Trim
      </button>
    </div>
  );
}

/** The box being kept on a page, with everything outside it greyed out. */
export function TrimLayer({ index, scale }: { index: number; scale: number }) {
  const box = useStore((s) => (s.trimBox?.page === index ? s.trimBox : null));
  if (!box) return null;
  return (
    <div className="trim-layer">
      <div className="trim-box" style={{ left: box.x * scale, top: box.y * scale, width: box.width * scale, height: box.height * scale }} />
    </div>
  );
}
