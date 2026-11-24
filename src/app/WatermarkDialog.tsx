/** The Watermark window: words or a picture, saved into the PDF's pages, with a live preview. */
import { useEffect, useRef, useState } from "react";

import { useStore } from "../model/store";
import {
  DEFAULT_WATERMARK,
  FONT_NAMES,
  PLACEMENT_NAMES,
  choosePages,
  cleanSettings,
  type FontChoice,
  type Placement,
  type WatermarkSettings,
} from "../model/watermark";
import { drawPage, loadPdf } from "../pdf/pdfjs";
import { LockedPdf, WatermarkProblem, addWatermark, loadForEditing, previewPage, type WatermarkPicture } from "../pdf/watermark";
import { applyChange } from "./editing";
import { Modal } from "./Modal";

/** The last choices are remembered on this computer. */
const KEY = "jurapdf.watermark";

function remembered(): WatermarkSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? cleanSettings(JSON.parse(raw)) : DEFAULT_WATERMARK;
  } catch {
    return DEFAULT_WATERMARK;
  }
}

/** The picture chosen last, kept until JuraPDF closes. */
let lastPicture: WatermarkPicture | undefined;

const SWATCHES = [
  ["#d1373a", "Red"],
  ["#7b8794", "Grey"],
  ["#1f6fd1", "Blue"],
  ["#000000", "Black"],
] as const;

export function WatermarkDialog() {
  const pdf = useStore((s) => s.pdf);
  const current = useStore((s) => s.currentPage);
  const close = () => useStore.getState().openDialog(null);
  const [s, setS] = useState<WatermarkSettings>(remembered);
  const [picture, setPicture] = useState<WatermarkPicture | undefined>(lastPicture);
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<WatermarkSettings>) => setS((old) => ({ ...old, ...change }));

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // Not remembered; still used now.
    }
  }, [s]);
  useEffect(() => {
    lastPicture = picture;
  }, [picture]);

  if (!pdf) return null;
  const count = pdf.sizes.length;
  const chosen = choosePages(s, count);
  const pages = "pages" in chosen ? chosen.pages : [];
  const pageError = "error" in chosen ? chosen.error : null;
  const missing = s.kind === "words" ? (s.text.trim() ? null : "Type the words for the watermark.") : picture ? null : "Choose a picture for the watermark.";
  const previewOf = pages.includes(current + 1) ? current + 1 : (pages[0] ?? current + 1);

  const apply = async () => {
    if (busy || pageError || missing || !pages.length) return;
    setBusy(true);
    try {
      const out = await addWatermark(pdf.bytes, s, picture);
      await applyChange(out.bytes as Uint8Array<ArrayBuffer>, "add watermark");
      close();
      useStore.getState().showToast(`Watermark added to ${out.pages.length === count ? "every page" : `${out.pages.length} ${out.pages.length === 1 ? "page" : "pages"}`}. Save to keep it.`, "success");
    } catch (e) {
      useStore.getState().showToast(e instanceof WatermarkProblem || e instanceof LockedPdf ? e.message : `Couldn't add the watermark: ${e instanceof Error ? e.message : String(e)}`, "error");
      setBusy(false);
    }
  };

  const choosePicture = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,.png,.jpg,.jpeg";
    input.className = "file-input";
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      void file.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        const png = bytes[0] === 0x89 && bytes[1] === 0x50;
        const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
        if (!png && !jpg) {
          useStore.getState().showToast(`${file.name} isn't a PNG or JPG picture.`, "error");
          return;
        }
        setPicture({ bytes, type: png ? "png" : "jpg", name: file.name });
      });
    };
    document.body.appendChild(input);
    input.click();
  };

  return (
    <Modal
      title="Watermark"
      onClose={close}
      width={820}
      footer={
        <div className="modal-actions">
          {(missing || (pageError && (s.pages !== "range" || s.range.trim()))) && <span className="muted print-busy">{missing ?? pageError}</span>}
          <button type="button" className="text-button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void apply()} disabled={busy || !!pageError || !!missing || !pages.length}>
            {busy ? "Adding…" : `Add to ${pages.length === count ? "every page" : `${pages.length} ${pages.length === 1 ? "page" : "pages"}`}`}
          </button>
        </div>
      }
    >
      <div className="print-layout watermark-layout">
        <WatermarkPreview page={previewOf} settings={s} picture={picture} />
        <div className="print-options">
          <div className="segmented two" role="radiogroup" aria-label="Watermark kind">
            {(
              [
                ["words", "Words"],
                ["picture", "Picture"],
              ] as const
            ).map(([k, label]) => (
              <button type="button" key={k} role="radio" aria-checked={s.kind === k} className={s.kind === k ? "selected" : ""} onClick={() => set({ kind: k })}>
                {label}
              </button>
            ))}
          </div>

          {s.kind === "words" ? (
            <>
              <label className="field">
                <span>Words</span>
                <input className="text-box" value={s.text} maxLength={200} aria-label="Watermark words" onChange={(e) => set({ text: e.target.value })} />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>Letters</span>
                  <select value={s.font} onChange={(e) => set({ font: e.target.value as FontChoice })} aria-label="Letters">
                    {Object.entries(FONT_NAMES).map(([k, name]) => (
                      <option key={k} value={k}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Size</span>
                  <select value={s.sizeMode === "fit" ? "fit" : "set"} onChange={(e) => set({ sizeMode: e.target.value as "fit" | "set" })} aria-label="Size">
                    <option value="fit">Fill the page</option>
                    <option value="set">Choose a size</option>
                  </select>
                </label>
              </div>
              {s.sizeMode === "set" && (
                <label className="field">
                  <span>Letter size (points; 12 is everyday print)</span>
                  <input className="text-box" type="number" min={4} max={400} value={s.size} onChange={(e) => set({ size: Math.min(400, Math.max(4, Number(e.target.value) || 4)) })} />
                </label>
              )}
              <div className="field-label">Colour</div>
              <div className="swatches">
                {SWATCHES.map(([c, name]) => (
                  <button
                    type="button"
                    key={c}
                    className={`swatch${s.colour.toLowerCase() === c ? " selected" : ""}`}
                    style={{ background: c }}
                    aria-label={name}
                    title={name}
                    onClick={() => set({ colour: c })}
                  />
                ))}
                <label className="swatch-other" title="Any colour">
                  <input type="color" value={s.colour} onChange={(e) => set({ colour: e.target.value })} aria-label="Any colour" />
                  Other…
                </label>
              </div>
            </>
          ) : (
            <div className="field">
              <span className="field-label">Picture (PNG or JPG, e.g. a logo)</span>
              <button type="button" className="text-button" onClick={choosePicture}>
                {picture ? `Change picture (${picture.name})` : "Choose a picture…"}
              </button>
              <label className="field">
                <span>Width: {s.pictureWidth}% of the page</span>
                <input type="range" min={5} max={100} value={s.pictureWidth} onChange={(e) => set({ pictureWidth: Number(e.target.value) })} aria-label="Picture width" />
              </label>
            </div>
          )}

          <div className="field-row">
            <label className="field">
              <span>Angle</span>
              <select value={s.angle} onChange={(e) => set({ angle: e.target.value as WatermarkSettings["angle"] })} aria-label="Angle">
                <option value="diagonal">Corner to corner</option>
                <option value="level">Level</option>
                <option value="custom">Choose an angle</option>
              </select>
            </label>
            <label className="field">
              <span>Where</span>
              <select value={s.placement} onChange={(e) => set({ placement: e.target.value as Placement })} aria-label="Where">
                {Object.entries(PLACEMENT_NAMES).map(([k, name]) => (
                  <option key={k} value={k}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {s.angle === "custom" && (
            <label className="field">
              <span>Angle in degrees (rising to the right; negative falls)</span>
              <input className="text-box" type="number" min={-180} max={180} value={s.customAngle} onChange={(e) => set({ customAngle: Math.min(180, Math.max(-180, Number(e.target.value) || 0)) })} />
            </label>
          )}

          <label className="field">
            <span>See-through: {s.seeThrough}%</span>
            <input type="range" min={0} max={95} step={5} value={s.seeThrough} onChange={(e) => set({ seeThrough: Number(e.target.value) })} aria-label="See-through" />
          </label>

          <div className="segmented two" role="radiogroup" aria-label="In front or behind">
            {(
              [
                [false, "In front of the page"],
                [true, "Behind the page"],
              ] as const
            ).map(([b, label]) => (
              <button type="button" key={label} role="radio" aria-checked={s.behind === b} className={s.behind === b ? "selected" : ""} onClick={() => set({ behind: b })}>
                {label}
              </button>
            ))}
          </div>
          {s.behind && <p className="dialog-hint">Behind can be hidden on scanned pages, which are one solid picture.</p>}

          <div className="field-label">Pages</div>
          <div className="segmented four" role="radiogroup" aria-label="Pages to watermark">
            {(
              [
                ["all", "All"],
                ["odd", "Odd"],
                ["even", "Even"],
                ["range", "Choose"],
              ] as const
            ).map(([p, label]) => (
              <button type="button" key={p} role="radio" aria-checked={s.pages === p} className={s.pages === p ? "selected" : ""} onClick={() => set({ pages: p })}>
                {label}
              </button>
            ))}
          </div>
          {s.pages === "range" && (
            <input className="text-box print-range" value={s.range} placeholder="e.g. 1-3, 5" aria-label="Pages to watermark" onChange={(e) => set({ range: e.target.value })} />
          )}
          <p className="dialog-hint">The watermark is saved into the pages. Undo takes it off again; Save keeps it.</p>
        </div>
      </div>
    </Modal>
  );
}

/** The page as it will look, drawn from a real one-page PDF with the watermark in. */
function WatermarkPreview({ page, settings, picture }: { page: number; settings: WatermarkSettings; picture?: WatermarkPicture }) {
  const pdf = useStore((s) => s.pdf);
  const holder = useRef<HTMLDivElement>(null);
  const source = useRef<{ bytes: Uint8Array; doc: Promise<Awaited<ReturnType<typeof loadForEditing>>> } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!pdf) return;
    let stopped = false;
    const timer = setTimeout(async () => {
      try {
        if (source.current?.bytes !== pdf.bytes) source.current = { bytes: pdf.bytes, doc: loadForEditing(pdf.bytes) };
        const src = await source.current.doc;
        const ready = settings.kind === "words" ? settings.text.trim() !== "" : !!picture;
        // With nothing to show yet, the page as it is.
        const bytes = ready ? await previewPage(src, page, settings, picture) : null;
        if (stopped) return;
        const doc = await loadPdf(bytes ?? pdf.bytes);
        const p = await doc.getPage(bytes ? 1 : page);
        const w = p.getViewport({ scale: 1 }).width;
        const canvas = document.createElement("canvas");
        await drawPage(p, canvas, 300 / w).promise;
        void doc.destroy();
        if (stopped) return;
        holder.current?.replaceChildren(canvas);
        setProblem(null);
      } catch (e) {
        if (!stopped) setProblem(e instanceof Error ? e.message : String(e));
      }
    }, 200);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pdf, page, settings, picture]);

  return (
    <figure className="print-preview">
      <div className="print-preview-page watermark-preview-page" ref={holder} />
      <figcaption className="muted small">{problem ?? `Page ${page}, with the watermark`}</figcaption>
    </figure>
  );
}
