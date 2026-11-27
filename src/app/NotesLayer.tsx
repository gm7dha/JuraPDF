/**
 * A page's sticky notes: a little note icon for each (in its colour), which a
 * click opens to read or change and a drag moves, and the open note's window
 * (its words, who wrote it and when, any replies, its colour).
 */
import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { colourCss, NOTE_COLOURS, NOTE_SIZE, whenLabel, type Note, type OpenNote } from "../model/notes";
import { useStore } from "../model/store";
import { Icons } from "./icons";
import { closeNote, deleteNote, moveNote, notesIn, openNote, saveNote, whileOpen } from "./noteActions";

interface Props {
  index: number;
  scale: number;
}

export const NotesLayer = memo(function NotesLayer({ index, scale }: Props) {
  const bytes = useStore((s) => s.pdf?.bytes);
  const open = useStore((s) => (s.note?.page === index ? s.note : null));
  // Other tools (drawing a shape, blacking out…) work over the notes.
  const busy = useStore((s) => (!!s.placing && s.placing.kind !== "note") || !!s.draft);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (!bytes) return;
    let stopped = false;
    void notesIn(bytes).then((all) => {
      if (!stopped) setNotes(all.filter((n) => n.page === index));
    });
    return () => {
      stopped = true;
    };
  }, [bytes, index]);

  if (!notes.length && !open) return null;
  return (
    <div className={`notes-layer${busy ? " busy" : ""}`}>
      {notes.map((n) => (
        <NoteIcon key={n.id} note={n} scale={scale} open={open?.id === n.id} />
      ))}
      {open && !open.id && <span className="note-icon open" style={iconPlace(open, scale)} aria-hidden="true"><Icons.Note /></span>}
      {open && <NoteWindow key={open.id ?? "new"} note={open} scale={scale} />}
    </div>
  );
});

function iconPlace(n: { x: number; y: number; colour: readonly number[] }, scale: number, dx = 0, dy = 0): CSSProperties {
  const size = NOTE_SIZE * scale;
  return { left: n.x * scale + dx, top: n.y * scale + dy, width: size, height: size, ["--note" as string]: colourCss(n.colour) };
}

function NoteIcon({ note, scale, open }: { note: Note; scale: number; open: boolean }) {
  const [moved, setMoved] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const tip = `${note.author ? `${note.author}: ` : ""}${note.text || "(an empty note)"}${note.replies.length ? ` (${note.replies.length} ${note.replies.length === 1 ? "reply" : "replies"})` : ""}`;

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, dragging: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.dragging && Math.hypot(dx, dy) < 4) return;
    s.dragging = true;
    setMoved({ dx, dy });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    start.current = null;
    if (!s?.dragging) return;
    const size = useStore.getState().pdf?.sizes[note.page];
    const [pw, ph] = size ?? [Infinity, Infinity];
    const x = Math.max(0, Math.min(pw - NOTE_SIZE, note.x + (e.clientX - s.x) / scale));
    const y = Math.max(0, Math.min(ph - NOTE_SIZE, note.y + (e.clientY - s.y) / scale));
    // Stays where it was dropped until the new version is drawn.
    void moveNote(note, x, y).finally(() => setMoved(null));
  };

  return (
    <button
      type="button"
      className={`note-icon${open ? " open" : ""}${moved ? " moving" : ""}`}
      style={iconPlace(note, scale, moved?.dx, moved?.dy)}
      aria-label={`Note: ${tip}`}
      title={`${tip}\nClick to read or change it; drag to move it.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null;
        setMoved(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!moved) openNote(note);
      }}
    >
      <Icons.Note />
    </button>
  );
}

const WINDOW_WIDTH = 270;

function NoteWindow({ note, scale }: { note: OpenNote; scale: number }) {
  const [text, setText] = useState(note.text);
  const [author, setAuthor] = useState(note.author);
  const [colour, setColour] = useState(NOTE_COLOURS.find((c) => c.rgb.every((v, i) => Math.abs(v - note.colour[i]) < 0.01))?.rgb ?? note.colour);
  const [saving, setSaving] = useState(false);
  const pageWidth = (useStore.getState().pdf?.sizes[note.page]?.[0] ?? 600) * scale;
  const iconRight = (note.x + NOTE_SIZE) * scale;
  // Beside the icon: to its right, or its left when there's no room.
  const left = iconRight + 8 + WINDOW_WIDTH <= pageWidth + 60 ? iconRight + 8 : Math.max(-WINDOW_WIDTH + 20, note.x * scale - WINDOW_WIDTH - 8);
  const when = whenLabel(note.when);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    await saveNote(note, text, author, colour);
    setSaving(false);
  };
  // A click away on the page saves it too.
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    whileOpen(() => latest.current());
    return () => whileOpen(null);
  }, []);

  return (
    <div
      className="note-window"
      role="dialog"
      aria-label={note.id ? "Note" : "New note"}
      style={{ left, top: note.y * scale, width: WINDOW_WIDTH, ["--note" as string]: colourCss(colour) }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") closeNote();
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
      }}
    >
      <div className="note-head">
        <input className="note-name" value={author} placeholder="Your name" aria-label="Your name" maxLength={80} onChange={(e) => setAuthor(e.target.value)} />
        {when && <span className="note-when">{when}</span>}
      </div>
      {note.replies.length > 0 && (
        <ul className="note-replies" aria-label="Replies">
          {note.replies.map((r) => (
            <li key={r.id}>
              <span className="note-reply-by">
                {r.author || "Someone"}
                {whenLabel(r.when) && ` · ${whenLabel(r.when)}`}
              </span>
              {r.text}
            </li>
          ))}
        </ul>
      )}
      <textarea className="note-text" value={text} autoFocus rows={5} placeholder="Type your note…" aria-label="Note" onChange={(e) => setText(e.target.value)} />
      <div className="note-foot">
        <div className="swatches">
          {NOTE_COLOURS.map((c) => (
            <button key={c.name} type="button" className={`swatch${colour === c.rgb ? " selected" : ""}`} style={{ background: colourCss(c.rgb) }} aria-label={`${c.name} note`} title={`${c.name} note`} onClick={() => setColour(c.rgb)} />
          ))}
        </div>
        {note.id && (
          <button type="button" className="icon-button" aria-label="Delete this note" title="Delete this note (and its replies)" onClick={() => void deleteNote(note)}>
            <Icons.Bin />
          </button>
        )}
        <button type="button" className="text-button" onClick={closeNote}>
          Cancel
        </button>
        <button type="button" className="primary-button" disabled={saving} onClick={() => void save()} title="Save the note (Ctrl+Enter)">
          Save
        </button>
      </div>
    </div>
  );
}
