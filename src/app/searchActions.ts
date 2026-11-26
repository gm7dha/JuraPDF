/**
 * The search bar's work: look through every page's words for what's typed,
 * a few pages at a time in the background (so even a long PDF stays snappy),
 * then show each place found in turn, going to its page.
 *
 * Each version of the PDF (after an edit, Undo, words read from pictures, pages
 * brought in) is looked through again, as its words may have changed. The words
 * of each version are kept once read, so typing more is quick.
 */
import { foldQuery, findOnPage, pageWords, stepHit, type SearchHit, type SearchState } from "../model/search";
import { useStore } from "../model/store";
import type { TextBit } from "../model/textOut";
import { pageTextBits, type PDFDocumentProxy } from "../pdf/pdfjs";
import { readWordsInPictures } from "./ocrActions";

/** Each version's pages' words, as read. */
const bitsCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextBit[]>>>();

function bitsFor(doc: PDFDocumentProxy, page: number): Promise<TextBit[]> {
  let pages = bitsCache.get(doc);
  if (!pages) bitsCache.set(doc, (pages = new Map()));
  let bits = pages.get(page);
  if (!bits) {
    // A page whose words can't be read counts as having none (it still shows).
    bits = pageTextBits(doc, page).catch(() => []);
    pages.set(page, bits);
  }
  return bits;
}

/** Folded words per page bits, for each way of matching. */
const wordsCache = new WeakMap<TextBit[], { exact?: ReturnType<typeof pageWords>; loose?: ReturnType<typeof pageWords> }>();
function wordsFor(bits: TextBit[], matchCase: boolean) {
  let kept = wordsCache.get(bits);
  if (!kept) wordsCache.set(bits, (kept = {}));
  const key = matchCase ? "exact" : "loose";
  return (kept[key] ??= pageWords(bits, matchCase));
}

/** Pages read at once (the background worker answers them together). */
const BATCH = 24;
/** How often the bar is brought up to date while looking (ms). */
const UPDATE_EVERY = 80;

const blank = (query = "", matchCase = false): SearchState => ({ query, matchCase, hits: [], current: -1, read: 0, total: 0, noWords: [], scrollTo: null, run: 0 });

let runs = 0;
let typing: ReturnType<typeof setTimeout> | undefined;

/** Open the search bar (or, if it's open, just put the typing spot in it). */
export function openSearch(): void {
  const s = useStore.getState();
  if (!s.pdf) return;
  if (!s.search) s.setSearch(blank());
  // After the bar is on the page.
  requestAnimationFrame(() => {
    const box = document.querySelector<HTMLInputElement>(".search-bar input");
    box?.focus();
    box?.select();
  });
}

export function closeSearch(): void {
  runs++;
  clearTimeout(typing);
  typing = undefined;
  useStore.getState().setSearch(null);
}

/** Typed in the box: look again a moment after typing stops, and show the first place found from this page on. */
export function setQuery(query: string): void {
  const s = useStore.getState().search;
  if (!s) return;
  // "Looking…" (not "Not found") until typing stops and the pages have been looked through.
  update({ query, read: 0, total: useStore.getState().pdf?.sizes.length ?? 0 });
  clearTimeout(typing);
  typing = setTimeout(() => {
    typing = undefined;
    void lookThrough("jump");
  }, query.length > 2 ? 120 : 250);
}

export function setMatchCase(matchCase: boolean): void {
  if (!useStore.getState().search) return;
  update({ matchCase, read: 0 });
  clearTimeout(typing);
  typing = undefined;
  void lookThrough("jump");
}

function update(patch: Partial<SearchState>): void {
  const s = useStore.getState().search;
  if (s) useStore.getState().setSearch({ ...s, ...patch });
}

/**
 * Look through every page for the query, from the page being read to the end
 * and then from the start (so places nearby show first, even in a long PDF).
 * "jump": show the first place found from the page being read on. "stay": the
 * PDF changed under an open search, so keep to the place being shown (or the
 * nearest after it) without moving.
 */
export async function lookThrough(how: "jump" | "stay"): Promise<void> {
  const st = useStore.getState();
  const pdf = st.pdf;
  const search = st.search;
  if (!pdf || !search) return;
  const run = ++runs;
  const folded = foldQuery(search.query, search.matchCase);
  const total = pdf.sizes.length;
  const fromPage = Math.min(total - 1, how === "stay" && search.current >= 0 ? (search.hits[search.current]?.page ?? st.currentPage) : st.currentPage);
  if (!folded) {
    useStore.getState().setSearch({ ...blank(search.query, search.matchCase), total, read: total, run });
    return;
  }
  // Places on the pages before the one being read, and from it on.
  const before: SearchHit[] = [];
  const ahead: SearchHit[] = [];
  const noWords: number[] = [];
  let shown: SearchHit | null = null;
  let jumped = how === "stay";
  let last = performance.now();
  let read = 0;
  useStore.getState().setSearch({ ...search, hits: [], current: -1, read: 0, total, noWords: [], scrollTo: null, run });
  const order = Array.from({ length: total }, (_, k) => (fromPage + k) % total);

  for (let start = 0; start < total; start += BATCH) {
    const pages = order.slice(start, start + BATCH);
    const all = await Promise.all(pages.map((p) => bitsFor(pdf.doc, p)));
    if (run !== runs || useStore.getState().pdf?.doc !== pdf.doc) return;
    all.forEach((bits, k) => {
      const page = pages[k];
      const words = wordsFor(bits, search.matchCase);
      if (!words.hasWords) noWords.push(page);
      (page >= fromPage ? ahead : before).push(...findOnPage(words, folded, page));
    });
    read += pages.length;
    const latest = useStore.getState().search;
    if (!latest || latest.run !== run) return;
    // Keep to the place the bar shows (Enter may have moved it meanwhile); at first, the first place from the page being read on.
    shown = latest.hits[latest.current] ?? shown ?? ahead[0] ?? (read >= total ? before[0] : null) ?? null;
    const now = performance.now();
    const jumpNow = !jumped && !!shown;
    if (jumpNow || read >= total || now - last > UPDATE_EVERY) {
      last = now;
      const hits = before.length ? before.concat(ahead) : ahead.slice();
      useStore.getState().setSearch({ ...latest, hits, current: shown ? hits.indexOf(shown) : -1, read, total, noWords: noWords.slice().sort((a, b) => a - b) });
      if (jumpNow) {
        jumped = true;
        showHit(hits.indexOf(shown!));
      }
      // Let the page breathe between batches (scrolling, typing).
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

/** The next (1) or previous (-1) place found. */
export function step(way: 1 | -1): void {
  const st = useStore.getState();
  const s = st.search;
  if (!s) return;
  // Enter pressed before typing stopped: look now (that shows the first place found).
  if (typing) {
    clearTimeout(typing);
    typing = undefined;
    void lookThrough("jump");
    return;
  }
  const next = stepHit(s.current, s.hits.length, way, st.currentPage, s.hits);
  if (next < 0) return;
  update({ current: next });
  showHit(next);
}

/** Show place `i`: scroll to it if its page is drawn, or else go to its page and scroll to it once drawn. */
export function showHit(i: number): void {
  const st = useStore.getState();
  const hit = st.search?.hits[i];
  if (!hit) return;
  const el = document.querySelector<HTMLElement>(`.page[data-page="${hit.page + 1}"] .search-hit[data-hit="${i}"]`);
  if (el) {
    scrollToHit(el);
    if (!st.onePage) st.setCurrentPage(hit.page);
    update({ scrollTo: null });
    return;
  }
  update({ scrollTo: i });
  st.goToPage(hit.page);
}

/** Bring a highlighted place into the middle of the window, unless it's already well in view. */
export function scrollToHit(el: HTMLElement): void {
  const scroller = el.closest<HTMLElement>(".page-scroller");
  if (!scroller) return;
  const view = scroller.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const margin = Math.min(80, view.height / 6);
  if (box.top < view.top + margin || box.bottom > view.bottom - margin) scroller.scrollTop += box.top - view.top - view.height * 0.35;
  if (box.left < view.left || box.right > view.right) scroller.scrollLeft += box.left - view.left - (view.width - box.width) / 2;
}

/** Read the words in the pictures on the pages that have none, then the search looks again by itself. */
export async function readPagesWithoutWords(): Promise<void> {
  const s = useStore.getState();
  if (!s.search?.noWords.length) return;
  s.setSelected(s.search.noWords);
  await readWordsInPictures();
}

// When the PDF changes under an open search (an edit, Undo, another file), look again.
useStore.subscribe((s, prev) => {
  if (!s.search || !s.pdf || s.pdf.doc === prev.pdf?.doc) return;
  clearTimeout(typing);
  typing = undefined;
  void lookThrough(s.pdf.openId === prev.pdf?.openId ? "stay" : "jump");
});
