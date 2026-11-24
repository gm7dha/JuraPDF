/**
 * The bookmarks down the left (the PDF's own list of chapters and sections).
 * Click one to go to its page; add one for the page being read, rename,
 * delete, move them about and fold them away.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { bookmarkAt, bookmarkForPage, cleanTitle, flatten, samePath, type Bookmark, type BookmarkMove, type BookmarkPath } from "../model/bookmarks";
import { useStore } from "../model/store";
import { addForCurrentPage, bookmarksOf, deleteBookmark, moveTo, renameBookmark, retarget, setFolded } from "./bookmarkActions";
import { Icons } from "./icons";

export function Bookmarks() {
  const pdf = useStore((s) => s.pdf);
  const current = useStore((s) => s.currentPage);
  const doc = pdf?.doc ?? null;
  const [tree, setTree] = useState<Bookmark[] | null>(null);
  const [chosen, setChosen] = useState<BookmarkPath | null>(null);
  const [renaming, setRenaming] = useState<BookmarkPath | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // A new version of the PDF (a change, Undo or another file): show its bookmarks.
  useEffect(() => {
    if (!doc) return;
    let stopped = false;
    const t = bookmarksOf(doc);
    if (Array.isArray(t)) setTree(t);
    else
      void t.then((read) => {
        if (!stopped) setTree(read);
      });
    return () => {
      stopped = true;
    };
  }, [doc]);

  // Another file: nothing chosen.
  const openId = pdf?.openId;
  useEffect(() => {
    setChosen(null);
    setRenaming(null);
  }, [openId]);

  const here = tree ? bookmarkForPage(tree, current) : null;
  const hereKey = here?.join(".") ?? "";
  // Keep the bookmark for the page being read in sight.
  useEffect(() => {
    if (hereKey) list.current?.querySelector<HTMLElement>(`[data-bookmark="${hereKey}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [hereKey]);

  if (!pdf || !doc) return null;
  if (!tree) return <div className="bookmarks muted">Reading the bookmarks…</div>;

  const pick = chosen && bookmarkAt(tree, chosen) ? chosen : null;
  const picked = pick ? bookmarkAt(tree, pick) : null;
  const rows = flatten(tree).filter((r) => r.shown);

  const go = (path: BookmarkPath, b: Bookmark) => {
    setChosen(path);
    if (b.page !== null) useStore.getState().goToPage(b.page);
  };
  const fold = (path: BookmarkPath, open: boolean) => setTree(setFolded(doc, tree, path, open));
  const add = async () => {
    const path = await addForCurrentPage(tree);
    if (path) {
      setChosen(path);
      setRenaming(path);
    }
  };
  const move = async (how: BookmarkMove) => {
    if (!pick) return;
    const path = await moveTo(tree, pick, how);
    if (path) setChosen(path);
  };
  const remove = async () => {
    if (pick && (await deleteBookmark(tree, pick))) setChosen(null);
  };
  const can = (how: BookmarkMove) => {
    if (!pick) return false;
    const i = pick[pick.length - 1];
    const parent = pick.slice(0, -1);
    const siblings = parent.length ? bookmarkAt(tree, parent)!.children : tree;
    if (how === "up" || how === "in") return i > 0;
    if (how === "down") return i < siblings.length - 1;
    return parent.length > 0;
  };

  const onRowKey = (e: KeyboardEvent, path: BookmarkPath, b: Bookmark) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go(path, b);
    } else if (e.key === "F2") {
      e.preventDefault();
      setChosen(path);
      setRenaming(path);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      // Not the page list's Delete (which deletes picked pages).
      e.preventDefault();
      e.stopPropagation();
      setChosen(path);
      void deleteBookmark(tree, path).then((done) => done && setChosen(null));
    }
  };

  return (
    <div className="bookmarks">
      <div className="bookmark-tools" role="toolbar" aria-label="Bookmark tools">
        <button type="button" className="icon-button small" onClick={() => void add()} aria-label="Add a bookmark" title={`Bookmark this page (page ${current + 1})`}>
          <Icons.Plus size={16} />
        </button>
        <button type="button" className="icon-button small" onClick={() => pick && setRenaming(pick)} disabled={!pick} aria-label="Rename the bookmark" title="Rename the chosen bookmark (F2)">
          <Icons.Pencil size={16} />
        </button>
        <button type="button" className="icon-button small" onClick={() => pick && void retarget(tree, pick)} disabled={!pick || picked?.page === current} aria-label="Point it at this page" title={`Make the chosen bookmark go to this page (page ${current + 1})`}>
          <Icons.Target size={16} />
        </button>
        <button type="button" className="icon-button small" onClick={() => void remove()} disabled={!pick} aria-label="Delete the bookmark" title="Delete the chosen bookmark (and any inside it)">
          <Icons.Bin size={16} />
        </button>
        <span className="bookmark-tools-gap" />
        <button type="button" className="icon-button small" onClick={() => void move("up")} disabled={!can("up")} aria-label="Move the bookmark up" title="Move it up">
          <Icons.Up size={16} />
        </button>
        <button type="button" className="icon-button small" onClick={() => void move("down")} disabled={!can("down")} aria-label="Move the bookmark down" title="Move it down">
          <Icons.Down size={16} />
        </button>
        <button type="button" className="icon-button small" onClick={() => void move("in")} disabled={!can("in")} aria-label="Put it inside the one above" title="Put it inside the bookmark above">
          <Icons.Indent size={16} />
        </button>
        <button type="button" className="icon-button small" onClick={() => void move("out")} disabled={!can("out")} aria-label="Take it out a level" title="Take it out of the bookmark it's in">
          <Icons.Outdent size={16} />
        </button>
      </div>

      <div className="bookmark-list" ref={list} role="tree" aria-label="Bookmarks">
        {rows.length === 0 && (
          <p className="bookmarks-empty muted">
            This PDF has no bookmarks yet. Go to a page and press <strong>+</strong> to bookmark it.
          </p>
        )}
        {rows.map(({ b, path, depth }) => {
          const key = path.join(".");
          const isChosen = samePath(path, pick);
          const isHere = samePath(path, here);
          return (
            <div
              key={key}
              className={`bookmark${isChosen ? " chosen" : ""}${isHere ? " here" : ""}${b.page === null ? " nowhere" : ""}`}
              style={{ paddingLeft: 4 + depth * 14 }}
              data-bookmark={key}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={isChosen}
              aria-expanded={b.children.length ? b.open : undefined}
            >
              {b.children.length ? (
                <button type="button" className="bookmark-fold" onClick={() => fold(path, !b.open)} aria-label={b.open ? `Fold away the bookmarks in ${b.title}` : `Show the bookmarks in ${b.title}`}>
                  <Icons.Chevron size={14} className={b.open ? "open" : undefined} />
                </button>
              ) : (
                <span className="bookmark-fold" />
              )}
              {samePath(path, renaming) ? (
                <RenameBox
                  title={b.title}
                  onDone={(title) => {
                    setRenaming(null);
                    const clean = title === null ? null : cleanTitle(title);
                    if (clean) void renameBookmark(tree, path, clean);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="bookmark-title"
                  onClick={() => go(path, b)}
                  onDoubleClick={() => setRenaming(path)}
                  onKeyDown={(e) => onRowKey(e, path, b)}
                  title={b.page !== null ? `${b.title} (page ${b.page + 1}). Double-click to rename.` : b.url ? `${b.title} (a web address: ${b.url})` : `${b.title} (it doesn't go to a page in this PDF)`}
                >
                  <span className="bookmark-name">{b.title}</span>
                  <span className="bookmark-page">{b.page !== null ? b.page + 1 : "–"}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Typing a bookmark's name: Enter or clicking away keeps it, Esc leaves it as it was (null). */
function RenameBox({ title, onDone }: { title: string; onDone(title: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (t: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(t);
  };
  return (
    <input
      ref={ref}
      className="bookmark-rename"
      defaultValue={title}
      maxLength={200}
      aria-label="Bookmark name"
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") {
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
