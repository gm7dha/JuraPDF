/**
 * Read the words in the pictures on the chosen pages (scans, photos) and
 * write them in, invisibly, so they can be picked, copied, highlighted and
 * found with Ctrl+F. One undo step.
 */
import { READING_SCALE, readingSummary, wordsToAdd, type HiddenWord } from "../model/ocr";
import { useStore } from "../model/store";
import { addHiddenWords } from "../pdf/additions";
import { readPicture } from "../pdf/ocr";
import { pageForReading } from "../pdf/pdfjs";
import { LockedPdf } from "../pdf/watermark";
import { applyChange } from "./editing";
import { chosenPages } from "./pageActions";

const say = (text: string, kind: "info" | "error" = "info") => useStore.getState().showToast(text, kind);

let fetched = false;

export async function readWordsInPictures(): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  if (!pdf || s.reading !== null) return;
  const pages = chosenPages();
  const which = pages.length === 1 ? `page ${pages[0] + 1}` : `${pages.length} pages`;
  say(fetched ? `Reading the words in the pictures on ${which}…` : `Reading the words in the pictures on ${which}… The first time, the reader is fetched (about 7 MB), then it works offline.`);
  s.setReading(0);
  try {
    const found = new Map<number, HiddenWord[]>();
    for (const [k, page] of pages.entries()) {
      const drawn = await pageForReading(pdf.doc, page, READING_SCALE);
      const words = await readPicture(drawn.canvas, (share, getting) => {
        if (!getting) useStore.getState().setReading((k + share) / pages.length);
      });
      fetched = true;
      found.set(page, wordsToAdd(words, drawn.words, drawn.scale));
      useStore.getState().setReading((k + 1) / pages.length);
    }
    // The PDF may have changed meanwhile (Undo, another change): the words belong to the version they were read from.
    if (useStore.getState().pdf?.bytes !== pdf.bytes) {
      say("The PDF changed while its words were being read, so nothing was added. Try again.", "error");
      return;
    }
    let bytes: Uint8Array = pdf.bytes;
    for (const [page, words] of found) if (words.length) bytes = await addHiddenWords(bytes, page, words);
    const counts = new Map([...found].map(([p, w]) => [p, w.length]));
    if (bytes !== pdf.bytes) await applyChange(bytes as Uint8Array<ArrayBuffer>, `read the words in the pictures on ${which}`);
    say(readingSummary(counts));
  } catch (e) {
    if (e instanceof LockedPdf) say("This PDF is locked against changes, so the words read can't be added to it.", "error");
    else say(`Couldn't read the words: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    useStore.getState().setReading(null);
  }
}
