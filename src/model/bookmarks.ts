/**
 * Bookmarks (a PDF's "outline"): named links to pages, which can hold
 * bookmarks of their own, like chapters and sections. Pure: the tree and the
 * changes to it. Reading and writing them in a PDF is src/pdf/bookmarks.ts.
 */

export interface Bookmark {
  title: string;
  /** The page it goes to (0 = first), or null when it goes nowhere in this PDF (e.g. its page was deleted). */
  page: number | null;
  /** A web address it opens instead of a page, kept as it was. */
  url?: string;
  /** Its own bookmarks show (open) or are folded away. */
  open: boolean;
  children: Bookmark[];
}

/** Where a bookmark is in the tree: its place among the top ones, then among that one's, and so on. */
export type BookmarkPath = number[];

export const MAX_TITLE = 200;

/** A title as typed, tidied (spaces trimmed, at most 200 letters); null when there's nothing left. */
export function cleanTitle(typed: string): string | null {
  const t = typed.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE).trim();
  return t || null;
}

export function bookmarkAt(tree: Bookmark[], path: BookmarkPath): Bookmark | null {
  let list = tree;
  let found: Bookmark | null = null;
  for (const i of path) {
    found = list[i] ?? null;
    if (!found) return null;
    list = found.children;
  }
  return found;
}

/** The list a bookmark sits in, changed by `fn` (a copy: the tree itself isn't changed). */
function editList(tree: Bookmark[], parent: BookmarkPath, fn: (list: Bookmark[]) => Bookmark[]): Bookmark[] {
  if (!parent.length) return fn(tree);
  const [i, ...rest] = parent;
  return tree.map((b, k) => (k === i ? { ...b, children: editList(b.children, rest, fn) } : b));
}

/** Change one bookmark. */
export function updateBookmark(tree: Bookmark[], path: BookmarkPath, fn: (b: Bookmark) => Bookmark): Bookmark[] {
  const i = path[path.length - 1];
  return editList(tree, path.slice(0, -1), (list) => list.map((b, k) => (k === i ? fn(b) : b)));
}

/** Delete a bookmark (and the bookmarks inside it). */
export function removeBookmark(tree: Bookmark[], path: BookmarkPath): Bookmark[] {
  const i = path[path.length - 1];
  return editList(tree, path.slice(0, -1), (list) => list.filter((_, k) => k !== i));
}

/** Put a bookmark in at `path` (the ones from there on move along one). */
export function insertBookmark(tree: Bookmark[], path: BookmarkPath, b: Bookmark): Bookmark[] {
  const i = path[path.length - 1];
  return editList(tree, path.slice(0, -1), (list) => [...list.slice(0, i), b, ...list.slice(i)]);
}

/** A new bookmark for a page, put among the top bookmarks in page order. Gives the new tree and where it went. */
export function addBookmark(tree: Bookmark[], page: number, title: string): { tree: Bookmark[]; path: BookmarkPath } {
  let at = tree.length;
  for (let i = tree.length - 1; i >= 0; i--) {
    const p = firstPage(tree[i]);
    if (p !== null && p > page) at = i;
    else if (p !== null) break;
  }
  const path = [at];
  return { tree: insertBookmark(tree, path, { title, page, open: false, children: [] }), path };
}

/** The first page a bookmark or any inside it goes to. */
function firstPage(b: Bookmark): number | null {
  if (b.page !== null) return b.page;
  for (const c of b.children) {
    const p = firstPage(c);
    if (p !== null) return p;
  }
  return null;
}

export type BookmarkMove = "up" | "down" | "in" | "out";

/**
 * Move a bookmark: up or down among its neighbours, in (inside the one above
 * it, last), or out (beside the one it's in, just after it). Gives the new
 * tree and where it is now, or null when it can't go that way.
 */
export function moveBookmark(tree: Bookmark[], path: BookmarkPath, how: BookmarkMove): { tree: Bookmark[]; path: BookmarkPath } | null {
  const b = bookmarkAt(tree, path);
  if (!b) return null;
  const parent = path.slice(0, -1);
  const i = path[path.length - 1];
  const siblings = parent.length ? bookmarkAt(tree, parent)!.children : tree;
  if (how === "up" || how === "down") {
    const j = how === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) return null;
    const swapped = editList(tree, parent, (list) => list.map((x, k) => (k === i ? list[j] : k === j ? list[i] : x)));
    return { tree: swapped, path: [...parent, j] };
  }
  if (how === "in") {
    if (i === 0) return null;
    const above = siblings[i - 1];
    const without = removeBookmark(tree, path);
    const into = [...parent, i - 1];
    const moved = updateBookmark(without, into, (x) => ({ ...x, open: true, children: [...x.children, b] }));
    return { tree: moved, path: [...into, above.children.length] };
  }
  if (!parent.length) return null;
  const without = removeBookmark(tree, path);
  const to = [...parent.slice(0, -1), parent[parent.length - 1] + 1];
  return { tree: insertBookmark(without, to, b), path: to };
}

/** Every bookmark with where it is, in reading order (`shown` false for ones inside a folded bookmark). */
export function flatten(tree: Bookmark[], isOpen: (path: BookmarkPath, b: Bookmark) => boolean = (_, b) => b.open): { b: Bookmark; path: BookmarkPath; depth: number; shown: boolean }[] {
  const out: { b: Bookmark; path: BookmarkPath; depth: number; shown: boolean }[] = [];
  const walk = (list: Bookmark[], parent: BookmarkPath, shown: boolean) => {
    list.forEach((b, i) => {
      const path = [...parent, i];
      out.push({ b, path, depth: parent.length, shown });
      walk(b.children, path, shown && isOpen(path, b));
    });
  };
  walk(tree, [], true);
  return out;
}

/** The bookmark for the page being read: the one going to the nearest page at or before it (the last such, inside ones winning). */
export function bookmarkForPage(tree: Bookmark[], page: number): BookmarkPath | null {
  let best: { path: BookmarkPath; page: number } | null = null;
  for (const { b, path } of flatten(tree)) {
    if (b.page === null || b.page > page) continue;
    if (!best || b.page >= best.page) best = { path, page: b.page };
  }
  return best?.path ?? null;
}

/** How many bookmarks there are, inside ones too. */
export function countBookmarks(tree: Bookmark[]): number {
  return tree.reduce((n, b) => n + 1 + countBookmarks(b.children), 0);
}

export const samePath = (a: BookmarkPath | null, b: BookmarkPath | null) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
