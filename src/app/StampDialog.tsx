/**
 * The Stamp window: a ready-made stamp ("APPROVED", "RECEIVED"…) or your own
 * words, in a colour, with a name and the date under them if wanted; then put
 * on a page like a picture (moved and sized there, changeable afterwards).
 */
import { useMemo, useState } from "react";

import { cleanStamp, STAMP_COLOURS, STAMP_MOST, STAMPS, stampLines, stampPlacingSize, type StampSettings } from "../model/stamps";
import { dataUrlBytes } from "../model/signature";
import { useStore } from "../model/store";
import { placePicture } from "./addActions";
import { Modal } from "./Modal";

const KEY = "jurapdf.stamp";
const FONT = 'bold {size}px "Helvetica Neue", Helvetica, Arial, sans-serif';

function readSettings(): StampSettings {
  try {
    return cleanStamp(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return cleanStamp(null);
  }
}

/** The stamp drawn as a picture with a see-through background (a PNG data link and its size), large enough to print sharply. */
export function drawStamp(s: StampSettings, now = new Date()): { png: string; width: number; height: number } | null {
  const { main, sub } = stampLines(s, now);
  if (!main) return null;
  const big = 96;
  const small = 40;
  const pad = 34;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  measure.font = FONT.replace("{size}", String(big));
  const mainW = measure.measureText(main).width;
  measure.font = FONT.replace("{size}", String(small));
  const subW = sub ? measure.measureText(sub).width : 0;
  const width = Math.ceil(Math.max(mainW, subW) + pad * 2);
  const height = Math.ceil(pad * 2 + big * 0.78 + (sub ? small * 1.35 : 0));
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d");
  if (!g) return null;
  g.globalAlpha = 0.88;
  g.strokeStyle = g.fillStyle = s.colour;
  // A thick frame with a thin one inside, round-cornered, as rubber stamps are.
  const frame = (inset: number, line: number, radius: number) => {
    g.lineWidth = line;
    g.beginPath();
    g.roundRect(inset, inset, width - inset * 2, height - inset * 2, radius);
    g.stroke();
  };
  frame(6, 10, 22);
  frame(17, 3, 14);
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = FONT.replace("{size}", String(big));
  g.fillText(main, width / 2, pad + big * 0.78);
  if (sub) {
    g.font = FONT.replace("{size}", String(small));
    g.fillText(sub, width / 2, pad + big * 0.78 + small * 1.2);
  }
  return { png: c.toDataURL("image/png"), width, height };
}

export function StampDialog() {
  const close = () => useStore.getState().openDialog(null);
  const [s, setS] = useState<StampSettings>(readSettings);
  const set = (change: Partial<StampSettings>) => setS((old) => ({ ...old, ...change }));
  const drawn = useMemo(() => drawStamp(s), [s]);

  const use = async () => {
    if (!drawn) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // Not remembered; it still works now.
    }
    const bytes = dataUrlBytes(drawn.png);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    close();
    await placePicture(
      { bytes, type: "png", name: "Stamp", url, stamp: stampLines(s, new Date()).main, ...stampPlacingSize(drawn.width, drawn.height) },
      "Click on a page where the stamp should go. Esc stops.",
    );
  };

  return (
    <Modal
      title="Stamp"
      onClose={close}
      width={600}
      footer={
        <div className="modal-actions">
          <button type="button" className="text-button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary-button" disabled={!drawn} onClick={() => void use()}>
            Put it on a page
          </button>
        </div>
      }
    >
      <div className="stamp-choices" role="list" aria-label="Ready-made stamps">
        {STAMPS.map((st) => (
          <button
            key={st.words}
            type="button"
            role="listitem"
            className={`stamp-choice${s.words.trim().toUpperCase() === st.words ? " selected" : ""}`}
            style={{ color: st.colour, borderColor: st.colour }}
            onClick={() => set({ words: st.words, colour: st.colour })}
          >
            {st.words}
          </button>
        ))}
      </div>
      <div className="field-row">
        <label className="field">
          <span>Words</span>
          <input className="text-box" value={s.words} maxLength={STAMP_MOST} aria-label="Stamp words" onChange={(e) => set({ words: e.target.value })} />
        </label>
        <label className="field">
          <span>Name (if wanted)</span>
          <input className="text-box" value={s.name} maxLength={STAMP_MOST} aria-label="Name on the stamp" placeholder="e.g. Kevin Pugh" onChange={(e) => set({ name: e.target.value })} />
        </label>
      </div>
      <div className="stamp-options">
        <div className="swatches">
          {STAMP_COLOURS.map((c) => (
            <button key={c.hex} type="button" className={`swatch${s.colour === c.hex ? " selected" : ""}`} style={{ background: c.hex }} aria-label={`${c.name} stamp`} title={c.name} onClick={() => set({ colour: c.hex })} />
          ))}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={s.date} onChange={(e) => set({ date: e.target.checked })} />
          Today's date under the words
        </label>
      </div>
      <div className="stamp-preview">{drawn ? <img src={drawn.png} alt="How the stamp looks" /> : <span className="muted">Type the stamp's words.</span>}</div>
    </Modal>
  );
}
