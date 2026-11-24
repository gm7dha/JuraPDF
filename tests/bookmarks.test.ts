import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  addBookmark,
  bookmarkAt,
  bookmarkForPage,
  cleanTitle,
  countBookmarks,
  flatten,
  moveBookmark,
  removeBookmark,
  updateBookmark,
  type Bookmark,
} from "../src/model/bookmarks";
import { readBookmarks, writeBookmarks } from "../src/pdf/bookmarks";
import { deletePages, reorderPages } from "../src/pdf/pages";

const bm = (title: string, page: number | null, children: Bookmark[] = [], open = false): Bookmark => ({ title, page, open, children });

const sample = (): Bookmark[] => [bm("Intro", 0), bm("Part one", 1, [bm("Section A", 1), bm("Section B", 2)], true), bm("End", 4)];

async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300 + i * 10, 400]);
  return doc.save();
}

async function readBack(bytes: Uint8Array): Promise<Bookmark[]> {
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    return await readBookmarks(doc);
  } finally {
    await doc.destroy();
  }
}

describe("bookmark changes", () => {
  it("tidies titles", () => {
    expect(cleanTitle("  Chapter\n 1  ")).toBe("Chapter 1");
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle("x".repeat(300))).toHaveLength(200);
  });

  it("finds, changes and deletes bookmarks by place", () => {
    const tree = sample();
    expect(bookmarkAt(tree, [1, 1])?.title).toBe("Section B");
    expect(bookmarkAt(tree, [3])).toBeNull();
    const renamed = updateBookmark(tree, [1, 0], (b) => ({ ...b, title: "First" }));
    expect(bookmarkAt(renamed, [1, 0])?.title).toBe("First");
    expect(bookmarkAt(tree, [1, 0])?.title).toBe("Section A");
    const less = removeBookmark(tree, [1]);
    expect(less.map((b) => b.title)).toEqual(["Intro", "End"]);
    expect(countBookmarks(tree)).toBe(5);
  });

  it("adds a new bookmark among the top ones in page order", () => {
    const { tree, path } = addBookmark(sample(), 3, "Page 4");
    expect(path).toEqual([2]);
    expect(tree.map((b) => b.title)).toEqual(["Intro", "Part one", "Page 4", "End"]);
    expect(addBookmark([], 0, "Page 1").path).toEqual([0]);
    expect(addBookmark(sample(), 9, "Last").path).toEqual([3]);
  });

  it("moves bookmarks up, down, in and out", () => {
    const tree = sample();
    const down = moveBookmark(tree, [0], "down")!;
    expect(down.tree.map((b) => b.title)).toEqual(["Part one", "Intro", "End"]);
    expect(down.path).toEqual([1]);
    expect(moveBookmark(tree, [0], "up")).toBeNull();
    expect(moveBookmark(tree, [0], "in")).toBeNull();
    expect(moveBookmark(tree, [0], "out")).toBeNull();

    const inside = moveBookmark(tree, [2], "in")!;
    expect(inside.path).toEqual([1, 2]);
    expect(bookmarkAt(inside.tree, [1])!.children.map((b) => b.title)).toEqual(["Section A", "Section B", "End"]);

    const out = moveBookmark(tree, [1, 0], "out")!;
    expect(out.path).toEqual([2]);
    expect(out.tree.map((b) => b.title)).toEqual(["Intro", "Part one", "Section A", "End"]);
  });

  it("knows the bookmark for the page being read", () => {
    const tree = sample();
    expect(bookmarkForPage(tree, 0)).toEqual([0]);
    expect(bookmarkForPage(tree, 1)).toEqual([1, 0]);
    expect(bookmarkForPage(tree, 3)).toEqual([1, 1]);
    expect(bookmarkForPage(tree, 6)).toEqual([2]);
    expect(bookmarkForPage([bm("Late", 3)], 1)).toBeNull();
  });

  it("lists bookmarks in reading order, hiding folded ones", () => {
    const tree = [bm("A", 0, [bm("A1", 0)]), bm("B", 1, [bm("B1", 1)], true)];
    expect(flatten(tree).map((r) => `${r.b.title}:${r.depth}:${r.shown}`)).toEqual(["A:0:true", "A1:1:false", "B:0:true", "B1:1:true"]);
  });
});

describe("bookmarks in the PDF", () => {
  it("writes bookmarks that pdf.js reads back the same", async () => {
    const tree: Bookmark[] = [...sample(), { title: "Website", page: null, url: "https://example.com/", open: false, children: [] }];
    tree[0].title = "Intro – café ✓";
    const bytes = await writeBookmarks(await blankPdf(5), tree);
    expect(await readBack(bytes)).toEqual(tree);
  });

  it("starts with none, and writing none takes them away", async () => {
    const plain = await blankPdf(2);
    expect(await readBack(plain)).toEqual([]);
    const marked = await writeBookmarks(plain, [bm("One", 0)]);
    expect(await readBack(marked)).toHaveLength(1);
    expect(await readBack(await writeBookmarks(marked, []))).toEqual([]);
  });

  it("keeps folded bookmarks folded", async () => {
    const tree = [bm("Shut", 0, [bm("Inside", 1, [bm("Deeper", 1)], true)], false)];
    expect(await readBack(await writeBookmarks(await blankPdf(2), tree))).toEqual(tree);
  });

  it("follows the pages when they move, and lets go of deleted ones", async () => {
    const bytes = await writeBookmarks(await blankPdf(3), [bm("First", 0), bm("Third", 2)]);
    const moved = await reorderPages(bytes, [2, 0, 1]);
    expect((await readBack(moved)).map((b) => b.page)).toEqual([1, 0]);
    const deleted = await deletePages(bytes, [2]);
    expect((await readBack(deleted)).map((b) => b.page)).toEqual([0, null]);
  });
});
