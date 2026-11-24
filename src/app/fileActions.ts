/**
 * Opening PDFs from the computer and saving them back.
 *
 * In Chrome and Edge this uses the browser's real Open and Save windows.
 * Other browsers (Safari, Firefox) open with the ordinary file picker and
 * save by downloading.
 */
import { isPdfName, looksLikePdf, PDF_EXTENSION, PDF_MIME, nameFromFileName } from "../model/pdfFile";
import { hasUnsavedChanges, useStore } from "../model/store";
import { loadPdf, NeedsPassword, pageSizes } from "../pdf/pdfjs";
import { downloadFile, safeFileName } from "./download";

// The File System Access API isn't in TypeScript's built-in types yet.
interface WritableFile {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableFile>;
}
interface PickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
}
type PickerWindow = Window & {
  showSaveFilePicker?: (o: PickerOptions) => Promise<FileHandle>;
  showOpenFilePicker?: (o: PickerOptions) => Promise<FileHandle[]>;
};

const PDF_TYPES = [{ description: "PDF document", accept: { [PDF_MIME]: [PDF_EXTENSION] } }];

const isCancel = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Ask for a PDF and open it. */
export async function openFromFile(): Promise<void> {
  try {
    const file = await pickPdfFile();
    if (file) await openFile(file);
  } catch (e) {
    useStore.getState().showToast(`Couldn't open: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

/** Ask for a PDF file from the computer. Null if nothing was chosen. */
export async function pickPdfFile(): Promise<File | null> {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: PDF_TYPES });
      return handle ? await handle.getFile() : null;
    } catch (e) {
      if (isCancel(e)) return null;
      throw e;
    }
  }
  // Other browsers: the ordinary file picker. (If it's closed without a choice, nothing more happens.)
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `${PDF_EXTENSION},${PDF_MIME}`;
    input.className = "file-input";
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    };
    input.oncancel = () => {
      input.remove();
      resolve(null);
    };
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Write a PDF to the computer: the Save window where there is one, else a
 * download. Gives the name it was saved as and whether it was downloaded, or
 * null if the Save window was closed.
 */
export async function writePdf(bytes: Uint8Array<ArrayBuffer>, suggested: string): Promise<{ name: string; downloaded: boolean } | null> {
  const blob = new Blob([bytes], { type: PDF_MIME });
  const w = window as PickerWindow;
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: suggested, types: PDF_TYPES });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return { name: handle.name, downloaded: false };
    } catch (e) {
      if (isCancel(e)) return null;
      throw e;
    }
  }
  downloadFile(blob, suggested);
  return { name: suggested, downloaded: true };
}

let opened = 0;

/** Ask before a new file replaces changes that haven't been saved. True = go ahead. */
export function okToReplace(): boolean {
  const s = useStore.getState();
  if (!hasUnsavedChanges(s)) return true;
  return window.confirm(`${s.pdf?.fileName ?? "This PDF"} has changes you haven't saved. Open another PDF anyway, and lose them?`);
}

/** Open a PDF (from a picker, dropped on the window, or double-clicked once installed). Returns true if it worked. */
export async function openFile(file: File, password?: string): Promise<boolean> {
  const s = useStore.getState();
  s.setOpening(file.name);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikePdf(bytes)) {
      s.showToast(
        isPdfName(file.name) ? `${file.name} doesn't look like a PDF inside. It may be damaged.` : `${file.name} isn't a PDF. JuraPDF opens PDF files.`,
        "error",
      );
      return false;
    }
    if (!password && !okToReplace()) return false;
    const doc = await loadPdf(bytes, password);
    const sizes = await pageSizes(doc);
    s.askPassword(null);
    s.setPdf({ fileName: file.name, bytes, doc, sizes, password, openId: ++opened });
    document.title = `${nameFromFileName(file.name)} · JuraPDF`;
    return true;
  } catch (e) {
    if (e instanceof NeedsPassword) {
      s.askPassword({ file, wrong: e.wrong });
      return false;
    }
    s.showToast(`Couldn't open ${file.name}: ${e instanceof Error ? e.message : String(e)}`, "error");
    return false;
  } finally {
    useStore.getState().setOpening(null);
  }
}

/** Save the PDF to the computer (always asks where; Safari and Firefox download it). */
export async function saveToFile(): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  if (!pdf) return;
  const suggested = `${safeFileName(nameFromFileName(pdf.fileName), "Document")}${PDF_EXTENSION}`;
  try {
    const saved = await writePdf(pdf.bytes, suggested);
    if (!saved) return;
    s.markSaved(saved.name);
    s.showToast(saved.downloaded ? `Saved ${saved.name} to your Downloads folder` : `Saved ${saved.name}`, "success");
  } catch (e) {
    s.showToast(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}
