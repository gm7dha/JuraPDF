/**
 * Small controls shared by the bars over things being placed or changed:
 * a colour button with one-click colours, how see-through, and the buttons
 * to copy or delete something already on the page.
 */
import { useEffect, useRef, useState } from "react";

import { SWATCHES } from "../model/additions";
import { deleteDraft, duplicateDraft, updateDraft, markDraft } from "./addActions";
import { Icons } from "./icons";
import { detectPlatform } from "./platform";

/** A colour button: click for a few colours to pick from (and "No fill" or "More colours…"). */
export function ColourButton({
  value,
  onChange,
  label,
  swatches = SWATCHES,
  allowNone = false,
}: {
  value: string | null;
  onChange: (colour: string | null) => void;
  label: string;
  swatches?: string[];
  allowNone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);
  const pick = (c: string | null) => {
    markDraft();
    onChange(c);
    setOpen(false);
  };
  return (
    <div className="colour-pick" ref={box}>
      <button type="button" className={`colour-button${value ? "" : " none"}`} aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span style={value ? { background: value } : undefined} />
      </button>
      {open && (
        <div className="colour-menu" role="menu" aria-label={label}>
          {allowNone && (
            <button type="button" role="menuitem" className={`swatch none${value ? "" : " on"}`} onClick={() => pick(null)} title="No fill" aria-label="No fill" />
          )}
          {swatches.map((c) => (
            <button type="button" role="menuitem" key={c} className={`swatch${value === c ? " on" : ""}`} style={{ background: c }} onClick={() => pick(c)} aria-label={c} title={c} />
          ))}
          <label className="swatch more" title="More colours…">
            <input
              type="color"
              aria-label="More colours"
              value={value ?? "#ffffff"}
              onFocus={markDraft}
              onInput={(e) => onChange((e.target as HTMLInputElement).value)}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}

const SEE_THROUGH = [0, 25, 50, 75];

/** How see-through: solid, or a quarter, half or three quarters see-through. */
export function SeeThrough({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      aria-label="See-through"
      title="How see-through it is (what's under it shows through)"
      value={SEE_THROUGH.includes(value) ? value : 0}
      onChange={(e) => {
        markDraft();
        onChange(Number(e.target.value));
      }}
    >
      {SEE_THROUGH.map((v) => (
        <option key={v} value={v}>
          {v ? `${v}% see-through` : "Solid"}
        </option>
      ))}
    </select>
  );
}

/** How thick lines are, in points. */
export function Thickness({ value }: { value: number }) {
  return (
    <input
      type="number"
      aria-label="Thickness"
      title="How thick the lines are, in points"
      min={0.5}
      max={20}
      step={0.5}
      value={value}
      onFocus={markDraft}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (e.target.value && Number.isFinite(v) && v > 0) updateDraft({ thickness: Math.min(20, Math.max(0.5, v)) });
      }}
    />
  );
}

/** Copy and Delete, for something already on the page. */
export function KeptButtons({ name }: { name: string }) {
  const mac = detectPlatform() === "mac";
  return (
    <>
      <button type="button" className="icon-button small" onClick={() => void duplicateDraft()} aria-label={`Copy the ${name}`} title={`Put a copy of the ${name} on the page (${mac ? "⌘" : "Ctrl"}+D)`}>
        <Icons.Copy size={15} />
      </button>
      <button type="button" className="icon-button small" onClick={() => void deleteDraft()} aria-label={`Delete the ${name}`} title={`Take the ${name} off the page (Delete)`}>
        <Icons.Bin size={15} />
      </button>
    </>
  );
}
