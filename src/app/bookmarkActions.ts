/**
 * The bookmarks of the open PDF: read once per version of it (and kept, with
 * which ones are folded), and changed by writing the whole list into a new
 * version, which Undo can step back from.
 */
import { addBookmark, bookmarkAt, moveBookmark, removeBookmark, updateBookmark, type Bookmark, type BookmarkMove, type BookmarkPath } from "../model/bookmarks";
import { useStore } from "../model/store";
import { readBookmarks, writeBookmarks } from "../pdf/bookmarks";
import type { PDFDocumentProxy } from "../pdf/pdfjs";
import { LockedPdf } from "../pdf/watermark";
import { applyChange } from "./editing";

const trees = new WeakMap<PDFDocumentProxy, Bookmark[] | Promise<Bookmark[]>>();

/** The bookmarks of a version of the PDF (read the first time it's asked for). */
export function bookmarksOf(doc: PDFDocumentProxy): Bookmark[] | Promise<Bookmark[]> {
  let tree = trees.get(doc);
  if (!tree) {
    const reading = readBookmarks(doc).then((t) => {
      trees.set(doc, t);
      return t;
    });
    trees.set(doc, reading);
    tree = reading;
  }
  return tree;
}

/** Fold or unfold a bookmark: only how the list shows (no new version), kept with this version. */
export function setFolded(doc: PDFDocumentProxy, tree: Bookmark[], path: BookmarkPath, open: boolean): Bookmark[] {
  const next = updateBookmark(tree, path, (b) => ({ ...b, open }));
  trees.set(doc, next);
  return next;
}

let busy = false;

/** Write `tree` as a new version labelled for Undo. Gives true when it's done. */
async function write(tree: Bookmark[], label: string): Promise<boolean> {
  const s = useStore.getState();
  if (busy || !s.pdf) return false;
  busy = true;
  try {
    const bytes = await writeBookmarks(s.pdf.bytes, tree);
    await applyChange(bytes, label);
    const now = useStore.getState().pdf;
    if (now) trees.set(now.doc, tree);
    return true;
  } catch (e) {
    const s = useStore.getState();
    if (e instanceof LockedPdf) s.showToast("This PDF is locked against changes, so its bookmarks can't be changed.", "error");
    else s.showToast(`Couldn't change the bookmarks: ${e instanceof Error ? e.message : String(e)}`, "error");
    return false;
  } finally {
    busy = false;
  }
}

const quoted = (title: string) => `“${title.length > 40 ? `${title.slice(0, 39)}…` : title}”`;

/** Bookmark the page being read. Gives where the new bookmark is (to rename it straight away). */
export async function addForCurrentPage(tree: Bookmark[]): Promise<BookmarkPath | null> {
  const page = useStore.getState().currentPage;
  const title = `Page ${page + 1}`;
  const added = addBookmark(tree, page, title);
  return (await write(added.tree, `add bookmark ${quoted(title)}`)) ? added.path : null;
}

export async function renameBookmark(tree: Bookmark[], path: BookmarkPath, title: string): Promise<boolean> {
  const b = bookmarkAt(tree, path);
  if (!b || b.title === title) return false;
  return write(updateBookmark(tree, path, (x) => ({ ...x, title })), `rename bookmark to ${quoted(title)}`);
}

/** Point a bookmark at the page being read. */
export async function retarget(tree: Bookmark[], path: BookmarkPath): Promise<boolean> {
  const b = bookmarkAt(tree, path);
  const page = useStore.getState().currentPage;
  if (!b || b.page === page) return false;
  return write(updateBookmark(tree, path, (x) => ({ ...x, page, url: undefined })), `point ${quoted(b.title)} at page ${page + 1}`);
}

export async function deleteBookmark(tree: Bookmark[], path: BookmarkPath): Promise<boolean> {
  const b = bookmarkAt(tree, path);
  if (!b) return false;
  const inside = b.children.length;
  const done = await write(removeBookmark(tree, path), `delete bookmark ${quoted(b.title)}`);
  if (done) useStore.getState().showToast(`Deleted ${quoted(b.title)}${inside ? ` and the ${inside === 1 ? "bookmark" : `${inside} bookmarks`} inside it` : ""}. Undo brings it back.`, "success");
  return done;
}

/** Move a bookmark; gives where it is now, or null when it couldn't move. */
export async function moveTo(tree: Bookmark[], path: BookmarkPath, how: BookmarkMove): Promise<BookmarkPath | null> {
  const moved = moveBookmark(tree, path, how);
  if (!moved) return null;
  return (await write(moved.tree, "move bookmark")) ? moved.path : null;
}
