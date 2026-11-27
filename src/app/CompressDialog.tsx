/** The "Make smaller" window: how small, then the PDF's pictures are brought down to size and leftovers tidied away. */
import { useState } from "react";

import { DEFAULT_SQUEEZE, SQUEEZES, type Squeeze } from "../model/compress";
import { sizeLabel } from "../model/pdfFile";
import { useStore } from "../model/store";
import { makeSmaller } from "./compressActions";
import { Modal } from "./Modal";

const KEY = "jurapdf.squeeze";

function remembered(): Squeeze {
  try {
    const v = localStorage.getItem(KEY);
    return v && v in SQUEEZES ? (v as Squeeze) : DEFAULT_SQUEEZE;
  } catch {
    return DEFAULT_SQUEEZE;
  }
}

export function CompressDialog() {
  const close = () => useStore.getState().openDialog(null);
  const size = useStore((s) => s.pdf?.bytes.length ?? 0);
  const [level, setLevel] = useState<Squeeze>(remembered);
  const [done, setDone] = useState<number | null>(null);

  const go = async () => {
    try {
      localStorage.setItem(KEY, level);
    } catch {
      // Not remembered; it still works now.
    }
    setDone(0);
    const changed = await makeSmaller(level, setDone);
    setDone(null);
    if (changed) close();
  };

  return (
    <Modal
      title="Make smaller"
      onClose={() => done === null && close()}
      width={480}
      footer={
        <div className="modal-actions">
          <button type="button" className="text-button" onClick={close} disabled={done !== null}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void go()} disabled={done !== null}>
            {done === null ? "Make smaller" : `Working… ${Math.round(done * 100)}%`}
          </button>
        </div>
      }
    >
      <p className="dialog-hint">
        This PDF is <strong>{sizeLabel(size)}</strong>. Pictures bigger than the pages need are brought down to size, and parts left over from earlier changes are tidied away. The words
        stay as sharp as ever. Undo brings back the original.
      </p>
      <div className="squeeze-choices" role="radiogroup" aria-label="How small">
        {(Object.keys(SQUEEZES) as Squeeze[]).map((k) => (
          <label key={k} className={`squeeze-choice${level === k ? " selected" : ""}`}>
            <input type="radio" name="squeeze" checked={level === k} onChange={() => setLevel(k)} disabled={done !== null} />
            <span>
              <strong>{SQUEEZES[k].name}</strong>
              <span className="muted small">{SQUEEZES[k].about}</span>
            </span>
          </label>
        ))}
      </div>
      {done !== null && <progress className="squeeze-progress" value={done} max={1} aria-label="How far along" />}
    </Modal>
  );
}
