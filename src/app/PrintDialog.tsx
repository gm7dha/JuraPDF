/** The Print window: which pages, and the watermark to print across them. */
import { useEffect, useRef, useState } from "react";

import { hasMark, parsePageRange, type PrintMark } from "../model/printMark";
import { useStore } from "../model/store";
import { Modal } from "./Modal";
import { PrintCancelled, pageWithMark, printPages } from "./printing";

type Which = "all" | "current" | "range";

/** The "Uncontrolled Document" tick is remembered on this computer; the work order is kept until JuraPDF closes. */
const KEY = "jurapdf.print.uncontrolled";
let lastWorkOrder = "";

function rememberedUncontrolled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function PrintDialog() {
  const pdf = useStore((s) => s.pdf);
  const current = useStore((s) => s.currentPage);
  const close = () => useStore.getState().openDialog(null);
  const [which, setWhich] = useState<Which>("all");
  const [range, setRange] = useState("");
  const [mark, setMark] = useState<PrintMark>(() => ({ uncontrolled: rememberedUncontrolled(), workOrder: lastWorkOrder }));
  const [busy, setBusy] = useState<string | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    lastWorkOrder = mark.workOrder;
    try {
      localStorage.setItem(KEY, mark.uncontrolled ? "1" : "0");
    } catch {
      // Not remembered; still used now.
    }
  }, [mark]);

  if (!pdf) return null;
  const count = pdf.sizes.length;
  const chosen = which === "all" ? { pages: Array.from({ length: count }, (_, i) => i + 1) } : which === "current" ? { pages: [current + 1] } : parsePageRange(range, count);
  const pages = "pages" in chosen ? chosen.pages : [];
  const error = "error" in chosen ? chosen.error : which === "range" && range.trim() === "" ? "Type the pages to print, e.g. 1-3, 5." : null;

  const print = async () => {
    if (!pages.length || error || busy) return;
    stop.current = false;
    setBusy("Getting the pages ready…");
    try {
      await printPages(
        pdf,
        pages,
        mark,
        (done, total) => setBusy(done < total ? `Getting page ${done + 1} of ${total} ready…` : "Opening the print window…"),
        () => stop.current,
      );
      close();
    } catch (e) {
      if (!(e instanceof PrintCancelled)) useStore.getState().showToast(`Couldn't print: ${e instanceof Error ? e.message : String(e)}`, "error");
      setBusy(null);
    }
  };

  const onClose = () => {
    if (busy) stop.current = true;
    close();
  };

  return (
    <Modal
      title="Print"
      onClose={onClose}
      width={720}
      footer={
        <div className="modal-actions">
          {busy && <span className="muted print-busy">{busy}</span>}
          <button type="button" className="text-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void print()} disabled={!pages.length || !!error || !!busy}>
            Print {pages.length > 0 && !error ? `${pages.length} ${pages.length === 1 ? "page" : "pages"}` : ""}
          </button>
        </div>
      }
    >
      <div className="print-layout">
        <PrintPreview page={pages[0] ?? current + 1} mark={mark} />
        <div className="print-options">
          <div className="field-label">Pages</div>
          <div className="segmented three" role="radiogroup" aria-label="Pages to print">
            {(
              [
                ["all", `All ${count}`],
                ["current", `Page ${current + 1}`],
                ["range", "Choose"],
              ] as const
            ).map(([w, label]) => (
              <button type="button" key={w} role="radio" aria-checked={which === w} className={which === w ? "selected" : ""} onClick={() => setWhich(w)}>
                {label}
              </button>
            ))}
          </div>
          {which === "range" && (
            <input
              className="text-box print-range"
              value={range}
              autoFocus
              placeholder="e.g. 1-3, 5"
              aria-label="Pages to print"
              onChange={(e) => setRange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void print()}
            />
          )}
          {error && which === "range" && range.trim() !== "" && <p className="dialog-hint attention">{error}</p>}

          <div className="field-label settings-gap">Watermark (printed across every page)</div>
          <label className="check-row">
            <input type="checkbox" checked={mark.uncontrolled} onChange={(e) => setMark({ ...mark, uncontrolled: e.target.checked })} />
            <span>
              <strong>Uncontrolled Document</strong>
            </span>
          </label>
          <label className="field">
            <span>Work Order</span>
            <input
              className="text-box"
              value={mark.workOrder}
              placeholder="e.g. W245354 (leave empty for none)"
              aria-label="Work Order"
              maxLength={60}
              onChange={(e) => setMark({ ...mark, workOrder: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && void print()}
            />
          </label>
          <p className="dialog-hint">
            {hasMark(mark)
              ? "The watermark is only on the printed pages. Your PDF itself isn't changed."
              : "No watermark: the pages print as they are."}
          </p>
        </div>
      </div>
    </Modal>
  );
}

/** A small picture of a page as it will print, watermark and all. */
function PrintPreview({ page, mark }: { page: number; mark: PrintMark }) {
  const pdf = useStore((s) => s.pdf);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pdf) return;
    let stopped = false;
    const timer = setTimeout(async () => {
      try {
        const [w] = pdf.sizes[page - 1];
        // About 260 pixels wide, sharp on high-resolution screens.
        const dpi = ((260 * (window.devicePixelRatio || 1)) / w) * 72;
        const canvas = await pageWithMark(pdf, page, mark, dpi);
        if (!stopped) holder.current?.replaceChildren(canvas);
      } catch {
        // No preview; printing still works.
      }
    }, 120);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pdf, page, mark]);
  return (
    <figure className="print-preview">
      <div className="print-preview-page" ref={holder} />
      <figcaption className="muted small">Page {page}, as it will print</figcaption>
    </figure>
  );
}
