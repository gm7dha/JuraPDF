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
