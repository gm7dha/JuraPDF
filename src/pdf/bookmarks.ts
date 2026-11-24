/**
 * A PDF's bookmarks: read with pdf.js (from a document it has opened, so this
 * file never loads pdf.js itself and also works in Node for the tests), and
 * written with pdf-lib, the whole list at once.
 */
import { PDFDict, PDFHexString, PDFName, PDFNull, PDFNumber, PDFString, type PDFRef } from "pdf-lib";

import type { Bookmark } from "../model/bookmarks";
import { loadForEditing } from "./watermark";

/** The parts of a pdf.js document that reading bookmarks needs. */
interface OutlineSource {
  getOutline(): Promise<OutlineItem[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
  numPages: number;
}

interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  url: string | null;
  count?: number;
  items: OutlineItem[];
}

/** Every bookmark in the PDF (an empty list when it has none). */
export async function readBookmarks(doc: OutlineSource): Promise<Bookmark[]> {
  let outline: OutlineItem[] | null;
  try {
    outline = await doc.getOutline();
  } catch {
    return [];
  }
  const walk = async (items: OutlineItem[]): Promise<Bookmark[]> => {
    const out: Bookmark[] = [];
    for (const item of items) {
      out.push({
        title: (item.title ?? "").replace(/\s+/g, " ").trim() || "Untitled",
        page: await pageOf(doc, item.dest),
        ...(item.url ? { url: item.url } : {}),
        open: (item.count ?? 0) > 0,
        children: await walk(item.items ?? []),
      });
    }
    return out;
  };
  return walk(outline ?? []);
}

async function pageOf(doc: OutlineSource, dest: string | unknown[] | null): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    const target = explicit?.[0];
    let page: number | null = null;
    if (typeof target === "number") page = target;
    else if (target && typeof target === "object" && "num" in target) page = await doc.getPageIndex(target as { num: number; gen: number });
    return page !== null && page >= 0 && page < doc.numPages ? page : null;
  } catch {
    // A page that has been deleted, or a link this reader can't follow.
    return null;
  }
}

/** The PDF with exactly these bookmarks (an empty list takes them all away). */
export async function writeBookmarks(bytes: Uint8Array, tree: Bookmark[]): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await loadForEditing(bytes);
  const ctx = doc.context;
  const pages = doc.getPages().map((p) => p.ref);
  const outlines = PDFName.of("Outlines");
  const pageMode = PDFName.of("PageMode");

  if (!tree.length) {
    doc.catalog.delete(outlines);
    if (doc.catalog.get(pageMode) === PDFName.of("UseOutlines")) doc.catalog.delete(pageMode);
    return doc.save() as Promise<Uint8Array<ArrayBuffer>>;
  }

  /** Writes a list under `parent`; gives its first and last and how many show when it's open. */
  const writeList = (list: Bookmark[], parent: PDFRef): { first: PDFRef; last: PDFRef; shown: number } => {
    const refs = list.map(() => ctx.nextRef());
    let shown = 0;
    list.forEach((b, k) => {
      const d = ctx.obj({}) as PDFDict;
      d.set(PDFName.of("Title"), PDFHexString.fromText(b.title));
      d.set(PDFName.of("Parent"), parent);
      if (k > 0) d.set(PDFName.of("Prev"), refs[k - 1]);
      if (k < list.length - 1) d.set(PDFName.of("Next"), refs[k + 1]);
      const page = b.page !== null ? pages[b.page] : undefined;
      if (page) d.set(PDFName.of("Dest"), ctx.obj([page, PDFName.of("XYZ"), PDFNull, PDFNull, PDFNull]));
      else if (b.url) d.set(PDFName.of("A"), ctx.obj({ S: PDFName.of("URI"), URI: PDFString.of(b.url) }));
      shown += 1;
      if (b.children.length) {
        const inside = writeList(b.children, refs[k]);
        d.set(PDFName.of("First"), inside.first);
        d.set(PDFName.of("Last"), inside.last);
        d.set(PDFName.of("Count"), PDFNumber.of(b.open ? inside.shown : -inside.shown));
        if (b.open) shown += inside.shown;
      }
      ctx.assign(refs[k], d);
    });
    return { first: refs[0], last: refs[refs.length - 1], shown };
  };

  const root = ctx.nextRef();
  const top = writeList(tree, root);
  ctx.assign(root, ctx.obj({ Type: PDFName.of("Outlines"), First: top.first, Last: top.last, Count: PDFNumber.of(top.shown) }));
  doc.catalog.set(outlines, root);
  return doc.save() as Promise<Uint8Array<ArrayBuffer>>;
}
