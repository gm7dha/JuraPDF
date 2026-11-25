/**
 * Saving out: pages as pictures (PNG or JPG; several go in one .zip), and all
 * the words as a text file. The open PDF doesn't change.
 */
import { pagesLabel, targetPages } from "../model/pages";
import { nameFromFileName } from "../model/pdfFile";
import { useStore } from "../model/store";
import { documentText, pageText } from "../model/textOut";
import { makeZip } from "../model/zip";
import { pagePicture, pageTextBits } from "../pdf/pdfjs";
import { safeFileName } from "./download";
import { writeFile, type FileKind } from "./fileActions";

const say = (text: string, kind: "info" | "error" | "success" = "info") => useStore.getState().showToast(text, kind);

const KINDS: Record<"png" | "jpg" | "zip" | "txt", FileKind> = {
  png: { description: "PNG picture", mime: "image/png", ext: ".png" },
  jpg: { description: "JPG picture", mime: "image/jpeg", ext: ".jpg" },
  zip: { description: "Zip file", mime: "application/zip", ext: ".zip" },
  txt: { description: "Text file", mime: "text/plain", ext: ".txt" },
};

/** Pictures this many dots to the inch: sharp enough to print, small enough to send. */
export const PICTURE_DPI = 200;

let busy = false;

const baseName = () => safeFileName(nameFromFileName(useStore.getState().pdf?.fileName ?? "Document"), "Document");

function saidSaved(what: string, saved: { name: string; downloaded: boolean } | null) {
  if (saved) say(`Saved ${what} as ${saved.name}${saved.downloaded ? " to your Downloads folder" : ""}.`, "success");
}

/** Save the chosen pages as pictures: one page as a single picture, several in a .zip. */
export async function savePagesAsPictures(type: "png" | "jpg" = "png"): Promise<void> {
  const s = useStore.getState();
  if (busy || !s.pdf) return;
  busy = true;
  try {
    const pages = targetPages(s.selected, s.currentPage, s.pdf.sizes.length);
    const doc = s.pdf.doc;
    const ext = KINDS[type].ext;
    if (pages.length > 1) say(`Making ${pages.length} pictures…`);
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const p of pages) files.push({ name: `${baseName()} - page ${p + 1}${ext}`, bytes: await pagePicture(doc, p, PICTURE_DPI, type) });
    const what = pages.length === 1 ? `page ${pages[0] + 1}` : pagesLabel(pages);
    if (files.length === 1) {
      saidSaved(`${what} as a picture`, await writeFile(new Blob([files[0].bytes as Uint8Array<ArrayBuffer>], { type: KINDS[type].mime }), files[0].name, KINDS[type]));
    } else {
      saidSaved(`${what} as pictures in a zip file`, await writeFile(new Blob([makeZip(files)], { type: KINDS.zip.mime }), `${baseName()} (${what}).zip`, KINDS.zip));
    }
  } catch (e) {
    say(`Couldn't save the pictures: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    busy = false;
  }
}

/** Save every word of the PDF as a text file, page by page. */
export async function saveWordsAsText(): Promise<void> {
  const s = useStore.getState();
  if (busy || !s.pdf) return;
  busy = true;
  try {
    const doc = s.pdf.doc;
    const pages: { page: number; text: string }[] = [];
    for (let p = 0; p < doc.numPages; p++) pages.push({ page: p + 1, text: pageText(await pageTextBits(doc, p)) });
    if (pages.every((p) => !p.text)) {
      say("This PDF has no words that can be picked, so there's nothing to save. If it's a scan, try Read words in pictures first.", "error");
      return;
    }
    const text = documentText(pages);
    saidSaved("the words", await writeFile(new Blob([text], { type: "text/plain;charset=utf-8" }), `${baseName()}.txt`, KINDS.txt));
  } catch (e) {
    say(`Couldn't save the words: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    busy = false;
  }
}
