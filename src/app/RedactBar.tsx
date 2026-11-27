/** While blacking out: how many places are marked, and the buttons to black them out for good or start again. */
import { marksLabel } from "../model/redact";
import { useStore } from "../model/store";
import { Icons } from "./icons";
import { blackOutMarked, clearMarks, startMarking, stopMarking } from "./redactActions";

export function RedactBar() {
  const marks = useStore((s) => s.marks);
  const marking = useStore((s) => s.placing?.kind === "redact");
  if (!marks.length && !marking) return null;
  return (
    <div className="redact-bar" role="toolbar" aria-label="Black out">
      <Icons.BlackOut size={16} />
      <span className="redact-count">{marks.length ? `${marksLabel(marks)} marked` : "Drag over what to black out"}</span>
      {marking ? (
        <button type="button" className="text-button" onClick={stopMarking} title="Stop marking (the marks stay)">
          Stop marking
        </button>
      ) : (
        <button type="button" className="text-button" onClick={startMarking} title="Mark more places by dragging over them">
          Mark more
        </button>
      )}
      {marks.length > 0 && (
        <>
          <button type="button" className="text-button" onClick={clearMarks}>
            Clear marks
          </button>
          <button
            type="button"
            className="primary-button danger"
            onClick={() => void blackOutMarked()}
            title="Black out everything marked. The words and pictures under the black are removed from the PDF, not just covered."
          >
            Black out for good
          </button>
        </>
      )}
    </div>
  );
}
