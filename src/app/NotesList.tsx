/** The Notes tab of the side panel: every sticky note in the PDF, in page order; a click goes to one and opens it. */
import { useEffect, useState } from "react";

import { colourCss, inReadingOrder, notesCount, noteSummary, whenLabel, type Note } from "../model/notes";
import { useStore } from "../model/store";
import { notesIn, showNote, startNoting } from "./noteActions";

export function NotesList() {
  const bytes = useStore((s) => s.pdf?.bytes);
  const openId = useStore((s) => s.note?.id);
  const [notes, setNotes] = useState<Note[] | null>(null);

  useEffect(() => {
    if (!bytes) return;
    let stopped = false;
    void notesIn(bytes).then((all) => {
      if (!stopped) setNotes(inReadingOrder(all));
    });
    return () => {
      stopped = true;
    };
  }, [bytes]);

  if (!notes) return <p className="notes-empty">Looking for notes…</p>;
  if (!notes.length)
    return (
      <div className="notes-empty">
        <p>No notes in this PDF yet.</p>
        <p>
          <button type="button" className="text-button" onClick={() => void startNoting()}>
            Add a note
          </button>{" "}
          (N), then click where it goes.
        </p>
      </div>
    );
  return (
    <>
      <div className="notes-empty" aria-live="polite">
        {notesCount(notes.length)}
      </div>
      <ul className="notes-list" aria-label="Notes">
        {notes.map((n) => (
          <li key={n.id}>
            <button type="button" className={openId === n.id ? "open" : ""} style={{ ["--note" as string]: colourCss(n.colour) }} onClick={() => showNote(n)}>
              <span className="note-by">
                Page {n.page + 1}
                {n.author && ` · ${n.author}`}
                {whenLabel(n.when) && ` · ${whenLabel(n.when)}`}
              </span>
              <span>{noteSummary(n.text) || "(an empty note)"}</span>
              {n.replies.length > 0 && <span className="note-by">{n.replies.length === 1 ? "1 reply" : `${n.replies.length} replies`}</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
