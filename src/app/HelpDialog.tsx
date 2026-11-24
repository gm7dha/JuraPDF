import { useRef, useState } from "react";

import { useStore } from "../model/store";
import { eggClick } from "./easterEgg";
import { Modal } from "./Modal";
import { detectPlatform, helpRows, type Platform } from "./platform";

export function HelpDialog() {
  const openDialog = useStore((s) => s.openDialog);
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform());
  const rows = helpRows(platform);
  // A little surprise (as in JuraCAD and JuraCUT): the Windows / Mac buttons clicked 10 times within 5 seconds.
  const clicks = useRef<number[]>([]);
  const [egg, setEgg] = useState(false);
  const choose = (p: Platform) => {
    setPlatform(p);
    const r = eggClick(clicks.current, performance.now());
    clicks.current = r.recent;
    if (r.found) setEgg(true);
  };
  return (
    <Modal title="Help and shortcuts" onClose={() => openDialog(null)} width={620}>
      <p>
        JuraPDF shows and edits PDF files, right here in your browser. <strong>Open</strong> a PDF (or drag one onto the window), move round it with the page list on the left, and{" "}
        <strong>Save</strong> it back to your computer. Your files never leave your computer.
      </p>
      <p>
        <strong>Print</strong> can write <strong>UNCONTROLLED DOCUMENT</strong> and a <strong>Work Order</strong> number across every printed page. Only the printout is
        marked; your PDF isn't changed.
      </p>
      <p className="muted">Coming next: watermarks saved into the PDF, then adding, removing and moving pages, and editing words and pictures.</p>
      <div className="platform-row">
        <span className="muted small">Shortcuts shown for</span>
        <div className="segmented two" role="radiogroup" aria-label="Keyboard type">
          {(["windows", "mac"] as const).map((p) => (
            <button type="button" key={p} role="radio" aria-checked={platform === p} className={platform === p ? "selected" : ""} onClick={() => choose(p)}>
              {p === "mac" ? "Mac" : "Windows"}
            </button>
          ))}
        </div>
      </div>
      <h3 className="help-heading">Mouse and touch</h3>
      <table className="help-table">
        <tbody>
          {rows.mouse.map(([a, b]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="help-heading">Keys</h3>
      <table className="help-table">
        <tbody>
          {rows.keys.map(([a, b]) => (
            <tr key={a}>
              <td>
                <kbd>{a}</kbd>
              </td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        JuraPDF is free and open source (MIT):{" "}
        <a href="https://github.com/gm7dha/JuraPDF" target="_blank" rel="noreferrer">
          github.com/gm7dha/JuraPDF
        </a>
        . It draws pages with Mozilla's{" "}
        <a href="https://mozilla.github.io/pdf.js/" target="_blank" rel="noreferrer">
          pdf.js
        </a>{" "}
        (Apache 2.0). Its sister programs are{" "}
        <a href="https://gm7dha.github.io/JuraCAD/" target="_blank" rel="noreferrer">
          JuraCAD
        </a>
        ,{" "}
        <a href="https://gm7dha.github.io/JuraCUT/" target="_blank" rel="noreferrer">
          JuraCUT
        </a>{" "}
        and{" "}
        <a href="https://gm7dha.github.io/JuraDAW/" target="_blank" rel="noreferrer">
          JuraDAW
        </a>
        .
      </p>
      {egg && (
        <div className="easter-egg" role="dialog" aria-label="Surprise!" onClick={() => setEgg(false)} title="Click to close">
          <img src={`${import.meta.env.BASE_URL}easter-egg.jpg`} alt="A happy spaniel in a teal harness, standing on a carved log" />
        </div>
      )}
    </Modal>
  );
}
