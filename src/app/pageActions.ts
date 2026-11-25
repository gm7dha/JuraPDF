/**
 * The page buttons: turn, delete, move, add a blank page, bring in pages from
 * another PDF, and save some pages as a new PDF. They work on the pages picked
 * in the page list, or else the page being read.
 */
import { isPdfName, looksLikePdf, nameFromFileName, PDF_EXTENSION } from "../model/pdfFile";
import { moveBy, moveTo, newPlaces, pagesLabel, sameOrder, targetPages } from "../model/pages";
import { useStore } from "../model/store";
import { pictureType, type PictureFile } from "../pdf/additions";
import { addBlankPage, deletePages, extractPages, insertPdf, insertPictures, PageProblem, reorderPages, turnPages } from "../pdf/pages";
import { LockedPdf } from "../pdf/watermark";
import { safeFileName } from "./download";
import { applyChange } from "./editing";
import { pickFiles, writePdf } from "./fileActions";

let busy = false;

/** Run one page change at a time, showing anything that goes wrong kindly. */
async function run(what: string, fn: () => Promise<void>): Promise<void> {
  if (busy || !useStore.getState().pdf) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    const s = useStore.getState();
    if (e instanceof PageProblem) s.showToast(e.message, "error");
    else if (e instanceof LockedPdf) s.showToast("This PDF is locked against changes, so its pages can't be changed.", "error");
    else s.showToast(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    busy = false;
  }
}

/** The pages a button works on now. */
export function chosenPages(): number[] {
  const s = useStore.getState();
  return targetPages(s.selected, s.currentPage, s.pdf?.sizes.length ?? 0);
}

/** Turn the chosen pages. */
export function turnChosen(by: 90 | -90): Promise<void> {
  return run("turn the pages", async () => {
    const pages = chosenPages();
    const picked = hasPicked();
    const bytes = await turnPages(useStore.getState().pdf!.bytes, pages, by);
    await applyChange(bytes, `turn ${pagesLabel(pages)}`);
    if (picked) useStore.getState().setSelected(pages);
  });
}

/** Delete the chosen pages. */
export function deleteChosen(): Promise<void> {
  return run("delete the pages", async () => {
    const pages = chosenPages();
    const bytes = await deletePages(useStore.getState().pdf!.bytes, pages);
    await applyChange(bytes, `delete ${pagesLabel(pages)}`);
    const s = useStore.getState();
    // Stay where the first deleted page was.
    s.goToPage(Math.min(pages[0], s.pdf!.sizes.length - 1));
    s.showToast(`Deleted ${pagesLabel(pages)}. Undo brings ${pages.length === 1 ? "it" : "them"} back.`, "success");
  });
}

/** Move the chosen pages one place up (-1) or down (+1). */
export function moveChosen(step: -1 | 1): Promise<void> {
  const pages = chosenPages();
  const order = moveBy(useStore.getState().pdf?.sizes.length ?? 0, pages, step);
  if (!order) return Promise.resolve();
  return reorder(order, pages, `move ${pagesLabel(pages)} ${step < 0 ? "up" : "down"}`);
}

/** Move pages (dragged in the page list) to just before the page at `before`. */
export function movePagesTo(pages: number[], before: number): Promise<void> {
  const order = moveTo(useStore.getState().pdf?.sizes.length ?? 0, pages, before);
  if (sameOrder(order)) return Promise.resolve();
  return reorder(order, pages, `move ${pagesLabel(pages)}`);
}

function reorder(order: number[], moving: number[], label: string): Promise<void> {
  return run("move the pages", async () => {
    const s = useStore.getState();
    const current = s.currentPage;
    const picked = hasPicked();
    const bytes = await reorderPages(s.pdf!.bytes, order);
    await applyChange(bytes, label);
    const places = newPlaces(order);
    const moved = moving.map((p) => places.get(p)!);
    if (picked) useStore.getState().setSelected(moved);
    useStore.getState().goToPage(moving.includes(current) ? places.get(current)! : Math.min(...moved));
  });
}

/** Add a blank page after the chosen pages. */
export function addBlank(): Promise<void> {
  return run("add a page", async () => {
    const pages = chosenPages();
    const at = pages[pages.length - 1] + 1;
    const bytes = await addBlankPage(useStore.getState().pdf!.bytes, at);
    await applyChange(bytes, "add a blank page");
    useStore.getState().goToPage(at);
  });
}

/** Ask for another PDF and bring all its pages in after the chosen pages. */
export function insertFromFile(): Promise<void> {
  return run("bring the pages in", async () => {
    const files = await pickFiles(
      [
        { description: "PDF document", mime: "application/pdf", ext: PDF_EXTENSION },
        { description: "PNG picture", mime: "image/png", ext: ".png" },
        { description: "JPG picture", mime: "image/jpeg", ext: ".jpg" },
        { description: "JPG picture", mime: "image/jpeg", ext: ".jpeg" },
      ],
      "PDFs and pictures",
    );
    if (!files.length) return;
    await bringIn(files);
  });
}

/** Bring in PDFs' pages and pictures (each picture as a page of its own), in the order given, after the chosen pages. */
export async function bringIn(files: File[]): Promise<void> {
  const pictures: PictureFile[] = [];
  const pdfs: File[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = pictureType(bytes);
    if (type) pictures.push({ bytes, type, name: f.name });
    else pdfs.push(f);
  }
  for (const f of pdfs) await insertFile(f);
  if (!pictures.length) return;
  const pages = chosenPages();
  const at = pages[pages.length - 1] + 1;
  const bytes = await insertPictures(useStore.getState().pdf!.bytes, pictures, at);
  const label = pictures.length === 1 ? pictures[0].name : `${pictures.length} pictures`;
  await applyChange(bytes, `bring in ${label} as ${pictures.length === 1 ? "a page" : "pages"}`);
  const s = useStore.getState();
  s.setSelected(Array.from({ length: pictures.length }, (_, k) => at + k));
  s.goToPage(at);
  s.showToast(`Brought in ${label} as ${pictures.length === 1 ? "a new page" : `${pictures.length} new pages`}. Save to keep ${pictures.length === 1 ? "it" : "them"}.`, "success");
}

async function insertFile(file: File): Promise<void> {
  const other = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(other)) {
    throw new PageProblem(isPdfName(file.name) ? `${file.name} doesn't look like a PDF inside. It may be damaged.` : `${file.name} isn't a PDF or a PNG or JPG picture, so it can't be brought in.`);
  }
  const pages = chosenPages();
  const at = pages[pages.length - 1] + 1;
  const out = await insertPdf(useStore.getState().pdf!.bytes, other, file.name, at);
  const label = `${out.added} ${out.added === 1 ? "page" : "pages"} from ${file.name}`;
  await applyChange(out.bytes, `bring in ${label}`);
  const s = useStore.getState();
  s.setSelected(Array.from({ length: out.added }, (_, k) => at + k));
  s.goToPage(at);
  s.showToast(`Brought in ${label}. Save to keep ${out.added === 1 ? "it" : "them"}.`, "success");
}

/** Save the chosen pages as a new PDF of their own (the open PDF doesn't change). */
export function saveChosenAsNew(): Promise<void> {
  return run("save the pages", async () => {
    const s = useStore.getState();
    const pages = chosenPages();
    const bytes = await extractPages(s.pdf!.bytes, pages);
    const name = `${safeFileName(nameFromFileName(s.pdf!.fileName), "Document")} (${pagesLabel(pages)})${PDF_EXTENSION}`;
    const saved = await writePdf(bytes, name);
    if (!saved) return;
    const where = saved.downloaded ? " to your Downloads folder" : "";
    useStore.getState().showToast(`Saved ${pagesLabel(pages)} as ${saved.name}${where}`, "success");
  });
}

/** True when pages are picked in the page list (rather than just the page being read). */
function hasPicked(): boolean {
  return useStore.getState().selected.length > 0;
}
