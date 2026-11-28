/**
 * The Changes tab of the side panel (while comparing with another PDF): what
 * was found, a button to mark the differences on this PDF for good, and the
 * list of them; a click on one shows it on its page.
 */
import { useEffect, useRef } from "react";

import { changeLine, compareSummary } from "../model/compare";
import { useStore } from "../model/store";
import { markChanges, showChange, startComparing, stepChange, stopComparing } from "./compareActions";

export function ChangesList() {
  const c = useStore((s) => s.compare);
  const list = useRef<HTMLUListElement>(null);
  const current = c?.current ?? -1;

  // Keep the change being shown in sight in the list.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-change="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  if (!c) return null;
  const changes = c.changes;
  const working = c.forDoc === null || c.progress !== null;
  return (
    <div className="changes">
      <div className="changes-top">
        <p className="changes-summary" aria-live="polite">
          {working ? c.progress ?? "Comparing…" : compareSummary(changes, c.otherName)}
        </p>
        {!working && !!changes?.length && (
          <div className="changes-buttons">
            <button type="button" className="text-button" onClick={() => stepChange(-1)} aria-label="The difference before" title="The difference before (Shift+F4)">
              ◀ Before
            </button>
            <button type="button" className="text-button" onClick={() => stepChange(1)} aria-label="The next difference" title="The next difference (F4)">
              Next ▶
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => void markChanges()}
              title="Mark them on this PDF for good: new words highlighted green, a red sticky note where words were taken out or changed (Undo takes it back)"
            >
              Mark them on this PDF
            </button>
          </div>
        )}
        <div className="changes-buttons">
          <button type="button" className="text-button" onClick={() => void startComparing()} title="Compare this PDF with a different file">
            Compare with another…
          </button>
          <button type="button" className="text-button" onClick={stopComparing} title="Stop comparing (the colours on the pages go)">
            Stop comparing
          </button>
        </div>
        {!working && (
          <p className="changes-key">
            <span className="changes-swatch put-in" /> put in <span className="changes-swatch changed" /> changed <span className="changes-swatch taken-out" /> taken out
          </p>
        )}
      </div>
      {!working && !!changes?.length && (
        <ul className="changes-list" aria-label="Differences" ref={list}>
          {changes.map((ch, i) => (
            <li key={i}>
              <button type="button" data-change={i} className={`${ch.kind}${i === current ? " open" : ""}`} onClick={() => showChange(i)}>
                <span className="note-by">
                  Page {ch.page + 1}
                  {ch.otherPage !== ch.page && ` (page ${ch.otherPage + 1} in the other)`}
                </span>
                <span>{changeLine(ch)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
