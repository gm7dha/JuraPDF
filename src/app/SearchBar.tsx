/**
 * The search bar (Ctrl+F, or the magnifying glass): type some words, and every
 * place they're found in the PDF is coloured in. Enter (or the arrows) goes to
 * the next place, Shift+Enter to the one before, Esc closes it.
 */
import { noWordsNote, searchCount } from "../model/search";
import { useStore } from "../model/store";
import { Icons } from "./icons";
import { markFound } from "./redactActions";
import { closeSearch, readPagesWithoutWords, setMatchCase, setQuery, step } from "./searchActions";

export function SearchBar() {
  const search = useStore((s) => s.search);
  const reading = useStore((s) => s.reading !== null);
  if (!search) return null;
  const count = searchCount(search);
  const done = search.read >= search.total;
  const note = search.query.trim() && done ? noWordsNote(search.noWords, search.total, search.hits.length > 0) : "";
  const none = !!search.query.trim() && done && !search.hits.length;
  return (
    <div className="search-bar" role="search" aria-label="Find words">
      <div className="search-row">
        <Icons.Search size={16} />
        <input
          className={none ? "not-found" : ""}
          value={search.query}
          placeholder="Find words"
          aria-label="Words to find"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              closeSearch();
            }
          }}
        />
        <span className={`search-count${none ? " not-found" : ""}`} role="status" aria-live="polite">
          {count}
        </span>
        <button
          type="button"
          className={`icon-button small${search.matchCase ? " active" : ""}`}
          onClick={() => setMatchCase(!search.matchCase)}
          aria-pressed={search.matchCase}
          aria-label="Match capitals"
          title={search.matchCase ? "Capitals and accents count (click to find words however they're written)" : "Only find words written with the same capitals and accents"}
        >
          <Icons.MatchCase size={16} />
        </button>
        <button type="button" className="icon-button small" onClick={() => step(-1)} disabled={!search.hits.length} aria-label="Previous place found" title="Previous place found (Shift+Enter)">
          <Icons.Up size={16} />
        </button>
        <button type="button" className="icon-button small" onClick={() => step(1)} disabled={!search.hits.length} aria-label="Next place found" title="Next place found (Enter)">
          <Icons.Down size={16} />
        </button>
        <button
          type="button"
          className="icon-button small"
          onClick={() => void markFound()}
          disabled={!search.hits.length}
          aria-label="Black out everything found"
          title="Mark every place found to black out (you check them, then click “Black out for good”)"
        >
          <Icons.BlackOut size={16} />
        </button>
        <button type="button" className="icon-button small" onClick={() => closeSearch()} aria-label="Close the search" title="Close (Esc)">
          <Icons.Cross size={14} />
        </button>
      </div>
      {note && (
        <div className="search-note">
          <span>{note}</span>
          <button type="button" className="link-button" onClick={() => void readPagesWithoutWords()} disabled={reading}>
            {reading ? "Reading…" : search.noWords.length === 1 ? "Read the words in its pictures" : "Read the words in their pictures"}
          </button>
        </div>
      )}
    </div>
  );
}
