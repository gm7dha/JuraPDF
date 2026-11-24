import { useState } from "react";

import { useStore } from "../model/store";
import { openFile } from "./fileActions";
import { Modal } from "./Modal";

/** Asks for the password of a protected PDF. */
export function PasswordDialog() {
  const pending = useStore((s) => s.passwordFor);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  if (!pending) return null;
  const close = () => useStore.getState().askPassword(null);
  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    await openFile(pending.file, password);
    setBusy(false);
    setPassword("");
  };
  return (
    <Modal
      title="This PDF has a password"
      onClose={close}
      width={420}
      footer={
        <div className="modal-actions">
          <button type="button" className="text-button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void submit()} disabled={!password || busy}>
            Open
          </button>
        </div>
      }
    >
      <p>
        <strong>{pending.file.name}</strong> is protected. Type its password to open it.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          className="text-box password-box"
          type="password"
          autoFocus
          value={password}
          aria-label="Password"
          autoComplete="off"
          onChange={(e) => setPassword(e.target.value)}
        />
      </form>
      {pending.wrong && <p className="dialog-hint attention">That password didn't work. Check Caps Lock and try again.</p>}
    </Modal>
  );
}
