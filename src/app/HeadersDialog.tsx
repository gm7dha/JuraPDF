/** The Headers window: page numbers and words along the top and bottom of pages, with a preview. */
import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";

import { DEFAULT_HEADERS, FIELDS, SLOT_NAMES, SLOTS, cleanHeaders, dateText, hasWords, headerPages, headersLabel, type HeaderSettings, type Slot } from "../model/headers";
import { useStore } from "../model/store";
import { FONT_NAMES, type FontChoice } from "../model/watermark";
import { HeaderProblem, addHeaders, headersIn, previewHeaders, removeHeaders } from "../pdf/headers";
import { drawPage, loadPdf } from "../pdf/pdfjs";
import { LockedPdf } from "../pdf/watermark";
import { applyChange } from "./editing";
import { Modal } from "./Modal";

/** The last choices are remembered on this computer. */
const KEY = "jurapdf.headers";

function remembered(): HeaderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? cleanHeaders(JSON.parse(raw)) : DEFAULT_HEADERS;
  } catch {
    return DEFAULT_HEADERS;
  }
}

const SWATCHES = [
  ["#333333", "Dark grey"],
  ["#000000", "Black"],
  ["#1f6fd1", "Blue"],
  ["#d1373a", "Red"],
] as const;

/** Ready-made settings for the usual jobs. */
const QUICK: { name: string; text: Partial<Record<Slot, string>>; digits?: number }[] = [
  { name: "Page 1 of 9", text: { bottomCentre: "Page {page} of {pages}" } },
  { name: "1, 2, 3…", text: { bottomCentre: "{page}" } },
  { name: "Numbers at the right", text: { bottomRight: "{page}" } },
  { name: "Bates numbers", text: { bottomRight: "ABC{page}" }, digits: 6 },
  { name: "Name and date", text: { topLeft: "{file}", topRight: "{date}", bottomCentre: "Page {page} of {pages}" } },
];

const MM = 72 / 25.4;

export function HeadersDialog() {
  const pdf = useStore((s) => s.pdf);
  const current = useStore((s) => s.currentPage);
  const close = () => useStore.getState().openDialog(null);
  const [s, setS] = useState<HeaderSettings>(remembered);
  /** This PDF already has JuraPDF's headers (they can be changed or taken off). */
  const [already, setAlready] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastBox, setLastBox] = useState<Slot>("bottomCentre");
  const boxes = useRef<Partial<Record<Slot, HTMLInputElement | null>>>({});
  const set = (change: Partial<HeaderSettings>) => setS((old) => ({ ...old, ...change }));
  const setText = (slot: Slot, text: string) => setS((old) => ({ ...old, text: { ...old.text, [slot]: text } }));
  const date = dateText(new Date());

  // A PDF that already has them opens with the settings they were added with.
  useEffect(() => {
    if (!pdf) return;
    let stopped = false;
    void headersIn(pdf.bytes).then((found) => {
      if (stopped || !found) return;
      setS(found);
      setAlready(true);
    });
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // Not remembered; still used now.
    }
  }, [s]);

  if (!pdf) return null;
  const count = pdf.sizes.length;
  const chosen = headerPages(s, count);
  const pages = "pages" in chosen ? chosen.pages : [];
  const pageError = "error" in chosen ? chosen.error : null;
  const missing = hasWords(s) ? null : "Type the words for at least one spot.";
  const previewOf = pages.includes(current + 1) ? current + 1 : (pages[0] ?? current + 1);

  const problem = (e: unknown, what: string) =>
    useStore.getState().showToast(e instanceof HeaderProblem || e instanceof LockedPdf ? e.message : `Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`, "error");

  const apply = async () => {
    if (busy || pageError || missing || !pages.length) return;
    setBusy(true);
    try {
      const out = await addHeaders(pdf.bytes, s, pdf.fileName, date);
      const what = headersLabel(s);
      await applyChange(out.bytes, `${already ? "change" : "add"} ${what}`);
      close();
      useStore.getState().showToast(`${what[0].toUpperCase()}${what.slice(1)} added to ${out.pages.length === count ? "every page" : `${out.pages.length} ${out.pages.length === 1 ? "page" : "pages"}`}. Save to keep them.`, "success");
    } catch (e) {
      problem(e, "add them");
      setBusy(false);
    }
  };

  const takeOff = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await applyChange(await removeHeaders(pdf.bytes), "take off headers and footers");
      close();
      useStore.getState().showToast("Headers and footers taken off. Undo puts them back.", "success");
    } catch (e) {
      problem(e, "take them off");
      setBusy(false);
    }
  };

  /** Put a code ({page}…) into the box last typed in, where the typing was. */
  const insert = (code: string) => {
    const el = boxes.current[lastBox];
    const text = s.text[lastBox];
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? at;
    setText(lastBox, text.slice(0, at) + code + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + code.length, at + code.length);
    });
  };

  return (
    <Modal
      title="Headers, footers and page numbers"
      onClose={close}
      width={860}
      footer={
        <div className="modal-actions">
          {(missing || (pageError && s.range.trim())) && <span className="muted print-busy">{missing ?? pageError}</span>}
          {already && (
            <button type="button" className="text-button" onClick={() => void takeOff()} disabled={busy}>
              Take them off
            </button>
          )}
          <button type="button" className="text-button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void apply()} disabled={busy || !!pageError || !!missing || !pages.length}>
            {busy ? "Adding…" : `${already ? "Change on" : "Add to"} ${pages.length === count ? "every page" : `${pages.length} ${pages.length === 1 ? "page" : "pages"}`}`}
          </button>
        </div>
      }
    >
      <div className="print-layout watermark-layout">
        <HeadersPreview page={previewOf} settings={s} date={date} />
        <div className="print-options">
          <div className="field-label">Quick start</div>
          <div className="quick-row">
            {QUICK.map((q) => (
              <button
                type="button"
                key={q.name}
                className="chip-button"
                onClick={() => set({ text: { ...Object.fromEntries(SLOTS.map((k) => [k, ""])), ...q.text } as HeaderSettings["text"], digits: q.digits ?? 0 })}
              >
                {q.name}
              </button>
            ))}
          </div>

          <div className="slot-grid">
            {SLOTS.map((slot) => (
              <label className="field" key={slot}>
                <span>{SLOT_NAMES[slot]}</span>
                <input
                  ref={(el) => (boxes.current[slot] = el)}
                  className="text-box"
                  value={s.text[slot]}
                  maxLength={200}
                  aria-label={SLOT_NAMES[slot]}
                  onFocus={() => setLastBox(slot)}
                  onChange={(e) => setText(slot, e.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="field-label">Put in ({SLOT_NAMES[lastBox].toLowerCase()})</div>
          <div className="quick-row">
            {FIELDS.map((f) => (
              <button type="button" key={f.code} className="chip-button" onClick={() => insert(f.code)} title={`Adds ${f.code}, which shows as the ${f.name.toLowerCase()} on each page`}>
                {f.name}
              </button>
            ))}
          </div>

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
              <input className="text-box" type="number" min={4} max={72} value={s.size} aria-label="Letter size" onChange={(e) => set({ size: Math.min(72, Math.max(4, Number(e.target.value) || 4)) })} />
            </label>
            <label className="field">
              <span>From the edge (mm)</span>
              <input
                className="text-box"
                type="number"
                min={0}
                max={70}
                value={Math.round(s.margin / MM)}
                aria-label="From the edge"
                onChange={(e) => set({ margin: Math.min(70, Math.max(0, Number(e.target.value) || 0)) * MM })}
              />
            </label>
          </div>
          <div className="swatches">
            {SWATCHES.map(([c, name]) => (
              <button type="button" key={c} className={`swatch${s.colour.toLowerCase() === c ? " selected" : ""}`} style={{ background: c }} aria-label={name} title={name} onClick={() => set({ colour: c })} />
            ))}
            <label className="swatch-other" title="Any colour">
              <input type="color" value={s.colour} onChange={(e) => set({ colour: e.target.value })} aria-label="Any colour" />
              Other…
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>First page's number</span>
              <input className="text-box" type="number" min={0} value={s.startAt} aria-label="First page's number" onChange={(e) => set({ startAt: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            </label>
            <label className="field">
              <span>Zeros in front (digits)</span>
              <select value={s.digits} onChange={(e) => set({ digits: Number(e.target.value) })} aria-label="Zeros in front">
                <option value={0}>None (1, 2, 3)</option>
                {[3, 4, 5, 6, 7, 8].map((d) => (
                  <option key={d} value={d}>
                    {d} digits ({"1".padStart(d, "0")})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field-label">Pages</div>
          <div className="segmented two" role="radiogroup" aria-label="Pages">
            {(
              [
                ["all", "All"],
                ["range", "Choose"],
              ] as const
            ).map(([p, label]) => (
              <button type="button" key={p} role="radio" aria-checked={s.pages === p} className={s.pages === p ? "selected" : ""} onClick={() => set({ pages: p })}>
                {label}
              </button>
            ))}
          </div>
          {s.pages === "range" && <input className="text-box print-range" value={s.range} placeholder="e.g. 2-10 (skip a cover page)" aria-label="Which pages" onChange={(e) => set({ range: e.target.value })} />}
          <p className="dialog-hint">
            They're saved into the pages. Adding them again replaces the ones JuraPDF added before, so they're easy to change; Undo takes them off.
          </p>
        </div>
      </div>
    </Modal>
  );
}

/** The page as it will look, from a real one-page PDF with the headers on. */
function HeadersPreview({ page, settings, date }: { page: number; settings: HeaderSettings; date: string }) {
  const pdf = useStore((s) => s.pdf);
  const holder = useRef<HTMLDivElement>(null);
  const source = useRef<{ bytes: Uint8Array; doc: Promise<PDFDocument> } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!pdf) return;
    let stopped = false;
    const timer = setTimeout(async () => {
      try {
        // A copy of its own: the PDF kept ready for the next change mustn't be touched by the preview.
        if (source.current?.bytes !== pdf.bytes) source.current = { bytes: pdf.bytes, doc: PDFDocument.load(pdf.bytes, { updateMetadata: false }) };
        const src = await source.current.doc;
        const bytes = await previewHeaders(src, page, settings, pdf.fileName, date);
        if (stopped) return;
        const doc = await loadPdf(bytes);
        const p = await doc.getPage(1);
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
  }, [pdf, page, settings, date]);

  return (
    <figure className="print-preview">
      <div className="print-preview-page watermark-preview-page" ref={holder} />
      <figcaption className="muted small">{problem ?? `Page ${page}, as it will look`}</figcaption>
    </figure>
  );
}
