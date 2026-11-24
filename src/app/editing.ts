/** Changing the open PDF: each change makes a new version, which Undo can step back from. */
import { useStore } from "../model/store";
import { loadPdf, pageSizes } from "../pdf/pdfjs";

/** Show `bytes` as the new version of the open PDF, labelled for Undo ("add watermark"). */
export async function applyChange(bytes: Uint8Array<ArrayBuffer>, label: string): Promise<void> {
  const s = useStore.getState();
  const pdf = s.pdf;
  if (!pdf) return;
  const doc = await loadPdf(bytes);
  const sizes = await pageSizes(doc);
  useStore.getState().changePdf({ ...pdf, bytes, doc, sizes, password: undefined }, label);
}

/**
 * A change from Claude (Live with Claude): one undo step labelled "Claude: …",
 * with a message. `replace` = Claude opened or started another PDF, which shows
 * from its first page. Resolves to a problem in words, or null when it's on show.
 */
export async function applyClaudeChange(name: string, bytes: Uint8Array<ArrayBuffer>, label: string, replace: boolean): Promise<string | null> {
  const s = useStore.getState();
  const pdf = s.pdf;
  if (!pdf) return "the user has no PDF open in JuraPDF";
  let doc: Awaited<ReturnType<typeof loadPdf>>;
  try {
    doc = await loadPdf(bytes);
  } catch (e) {
    return `JuraPDF couldn't open it (${e instanceof Error ? e.message : String(e)})`;
  }
  const sizes = await pageSizes(doc);
  // The user may have changed or closed the PDF meanwhile: then it's not applied.
  if (useStore.getState().pdf !== pdf) {
    void doc.destroy();
    return "the PDF changed in JuraPDF at the same moment";
  }
  useStore.getState().changePdf({ ...pdf, bytes, doc, sizes, password: undefined, fileName: replace ? name : pdf.fileName }, label);
  const now = useStore.getState();
  if (replace) {
    now.goToPage(0);
    document.title = `${name.replace(/\.pdf$/i, "")} · JuraPDF`;
  }
  now.showToast(label, "info");
  return null;
}
