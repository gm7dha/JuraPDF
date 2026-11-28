/**
 * The Sign window: draw a signature (mouse, finger or pen), type it in a
 * handwriting style, or bring in a picture of it; then put it on a page like a
 * picture. Signatures are kept on this computer to use again.
 */
import { useEffect, useRef, useState } from "react";

import { HANDWRITING, clearPaper, cleanSaved, dataUrlBytes, inkBounds, placingSize, withSaved, type SavedSignature } from "../model/signature";
import { useStore } from "../model/store";
import { placePicture, signInBox } from "./addActions";
import { Modal } from "./Modal";

const KEY = "jurapdf.signatures";

function readSaved(): SavedSignature[] {
  try {
    return cleanSaved(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function keep(list: SavedSignature[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not kept (private browsing, or full): it can still be used now.
  }
}

type Way = "draw" | "type" | "picture";

const INKS = [
  ["#000000", "Black"],
  ["#1f3f9f", "Blue"],
] as const;

/** Pad size in CSS pixels (drawn at twice that, for sharp lines). */
const PAD_W = 520;
const PAD_H = 180;

/** The ink on a canvas, cut down to just the ink (with a little room), as a PNG; null if it's empty. */
function inkOnly(canvas: HTMLCanvasElement, makePaperClear: boolean): SavedSignature | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (makePaperClear) {
    clearPaper(image.data);
    ctx.putImageData(image, 0, 0);
  }
  const box = inkBounds(image.data, canvas.width, canvas.height);
  if (!box) return null;
  const pad = Math.round(Math.max(box.width, box.height) * 0.03) + 2;
  const out = document.createElement("canvas");
  out.width = box.width + pad * 2;
  out.height = box.height + pad * 2;
  out.getContext("2d")?.drawImage(canvas, box.x - pad, box.y - pad, out.width, out.height, 0, 0, out.width, out.height);
  return { id: `${Date.now()}`, png: out.toDataURL("image/png"), width: out.width, height: out.height };
}

export function SignDialog() {
  const close = () => useStore.getState().openDialog(null);
  const [saved, setSaved] = useState<SavedSignature[]>(readSaved);
  const [way, setWay] = useState<Way>("draw");
  const [ink, setInk] = useState<string>(INKS[0][0]);
  const [typed, setTyped] = useState("");
  const [style, setStyle] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [picture, setPicture] = useState<SavedSignature | null>(null);
  const [remember, setRemember] = useState(true);
  const pad = useRef<HTMLCanvasElement>(null);

  // Typed: drawn onto the pad in the chosen handwriting.
  useEffect(() => {
    if (way !== "type") return;
    const c = pad.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!typed.trim()) return;
    let size = 110;
    ctx.font = `${size}px ${HANDWRITING[style].css}`;
    const w = ctx.measureText(typed).width;
    if (w > c.width * 0.92) size = Math.floor((size * c.width * 0.92) / w);
    ctx.font = `${size}px ${HANDWRITING[style].css}`;
    ctx.fillStyle = ink;
    // Sitting on the line, as if written on it.
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    ctx.fillText(typed, c.width / 2, c.height * 0.74);
  }, [way, typed, style, ink]);

  // Changing how it's made starts the pad afresh.
  useEffect(() => {
    const c = pad.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  }, [way]);

  const use = async (sig: SavedSignature, save: boolean) => {
    if (save) {
      const list = withSaved(saved, sig);
      setSaved(list);
      keep(list);
    }
    const bytes = dataUrlBytes(sig.png);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const picture = { bytes, type: "png" as const, name: "Signature", url, ...placingSize(sig.width, sig.height) };
    // Opened from a form's signature box: the signature goes in that box.
    const box = useStore.getState().signBox;
    close();
    if (box) await signInBox(picture, box);
    else await placePicture(picture, "Click on a page where the signature should go. Esc stops.");
  };

  const fromPad = () => {
    const c = pad.current;
    if (!c) return;
    const sig = inkOnly(c, false);
    if (!sig) {
      useStore.getState().showToast(way === "type" ? "Type your name first." : "Sign in the box first.", "error");
      return;
    }
    void use(sig, remember);
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
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // Big photos are brought down to a sensible size first.
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const sig = inkOnly(c, true);
        if (!sig) useStore.getState().showToast(`No signature could be found in ${file.name}: it looks blank.`, "error");
        setPicture(sig);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        useStore.getState().showToast(`${file.name} couldn't be read as a picture. Try a PNG or JPG.`, "error");
      };
      img.src = url;
    };
    document.body.appendChild(input);
    input.click();
  };

  // Drawing on the pad.
  const last = useRef<{ x: number; y: number } | null>(null);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * e.currentTarget.width) / r.width, y: ((e.clientY - r.top) * e.currentTarget.height) / r.height };
  };
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }, pressure: number) => {
    const ctx = pad.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = ink;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.2 + 2.4 * (pressure || 0.5);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const remove = (id: string) => {
    const list = saved.filter((s) => s.id !== id);
    setSaved(list);
    keep(list);
  };

  return (
    <Modal
      title="Sign"
      onClose={close}
      width={620}
      footer={
        <div className="modal-actions">
          {way !== "picture" && (
            <label className="check-row">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Keep it on this computer to use again
            </label>
          )}
          <button type="button" className="text-button" onClick={close}>
            Cancel
          </button>
          {way === "picture" ? (
            <button type="button" className="primary-button" disabled={!picture} onClick={() => picture && void use(picture, true)}>
              Put it on a page
            </button>
          ) : (
            <button type="button" className="primary-button" disabled={way === "draw" ? !drawn : !typed.trim()} onClick={fromPad}>
              Put it on a page
            </button>
          )}
        </div>
      }
    >
      {saved.length > 0 && (
        <>
          <div className="field-label">Your signatures (click one to put it on a page)</div>
          <div className="saved-signatures">
            {saved.map((sig) => (
              <div className="saved-signature" key={sig.id}>
                <button type="button" className="saved-signature-use" onClick={() => void use(sig, false)} aria-label="Use this signature" title="Put this signature on a page">
                  <img src={sig.png} alt="A kept signature" />
                </button>
                <button type="button" className="black-mark-x" onClick={() => remove(sig.id)} aria-label="Forget this signature" title="Forget this signature">
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="segmented three" role="radiogroup" aria-label="How to sign">
        {(
          [
            ["draw", "Draw"],
            ["type", "Type"],
            ["picture", "Picture"],
          ] as const
        ).map(([w, label]) => (
          <button type="button" key={w} role="radio" aria-checked={way === w} className={way === w ? "selected" : ""} onClick={() => setWay(w)}>
            {label}
          </button>
        ))}
      </div>

      {way === "picture" ? (
        <div className="sign-picture">
          <p className="dialog-hint">A photo or scan of your signature on white paper: the paper is made see-through, so only the ink goes on the page.</p>
          <button type="button" className="text-button" onClick={choosePicture}>
            {picture ? "Choose another picture…" : "Choose a picture…"}
          </button>
          {picture && <img className="sign-preview" src={picture.png} alt="Your signature, with the paper made see-through" />}
        </div>
      ) : (
        <>
          {way === "type" && (
            <div className="field-row">
              <label className="field">
                <span>Your name</span>
                <input className="text-box" value={typed} maxLength={60} autoFocus aria-label="Your name" onChange={(e) => setTyped(e.target.value)} />
              </label>
              <label className="field">
                <span>Style</span>
                <select value={style} onChange={(e) => setStyle(Number(e.target.value))} aria-label="Style">
                  {HANDWRITING.map((h, i) => (
                    <option key={h.name} value={i}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <canvas
            ref={pad}
            className={`sign-pad${way === "draw" ? " drawing" : ""}`}
            width={PAD_W * 2}
            height={PAD_H * 2}
            aria-label={way === "draw" ? "Sign here" : "Your typed signature"}
            onPointerDown={(e) => {
              if (way !== "draw") return;
              e.currentTarget.setPointerCapture(e.pointerId);
              last.current = at(e);
              stroke(last.current, last.current, e.pressure);
              setDrawn(true);
            }}
            onPointerMove={(e) => {
              if (way !== "draw" || !last.current) return;
              const events = "getCoalescedEvents" in e.nativeEvent ? e.nativeEvent.getCoalescedEvents() : [];
              for (const ev of events.length ? events : [e.nativeEvent]) {
                const r = e.currentTarget.getBoundingClientRect();
                const p = { x: ((ev.clientX - r.left) * e.currentTarget.width) / r.width, y: ((ev.clientY - r.top) * e.currentTarget.height) / r.height };
                stroke(last.current, p, ev.pressure);
                last.current = p;
              }
            }}
            onPointerUp={() => (last.current = null)}
            onPointerCancel={() => (last.current = null)}
          />
          <div className="sign-tools">
            <div className="swatches">
              {INKS.map(([c, name]) => (
                <button type="button" key={c} className={`swatch${ink === c ? " selected" : ""}`} style={{ background: c }} aria-label={`${name} ink`} title={`${name} ink`} onClick={() => setInk(c)} />
              ))}
            </div>
            {way === "draw" && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  const c = pad.current;
                  c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
                  setDrawn(false);
                }}
              >
                Start again
              </button>
            )}
          </div>
          {way === "draw" && <p className="dialog-hint">Sign in the box with the mouse, a finger or a pen.</p>}
          {way === "type" && <p className="dialog-hint">The styles use the handwriting letters your computer has, so they look a little different on each computer.</p>}
        </>
      )}
    </Modal>
  );
}
