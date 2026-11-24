/**
 * Choosing pages in the page list, and working out new page orders. Pure, so
 * it can be tested. Pages are counted from 0 here (page 1 is 0).
 */

/** How a click picks pages: on its own, adding/taking away one (Ctrl/⌘), or a run from the last one picked (Shift). */
export type ClickKind = "only" | "toggle" | "run";

/** The pages picked after a click on page `i`. `anchor` is the page a Shift-run starts from. */
export function pickPages(selected: number[], i: number, kind: ClickKind, anchor: number | null): number[] {
  if (kind === "toggle") return selected.includes(i) ? selected.filter((p) => p !== i) : [...selected, i].sort((a, b) => a - b);
  if (kind === "run" && anchor !== null) {
    const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
    return Array.from({ length: b - a + 1 }, (_, k) => a + k);
  }
  return [i];
}

/** The pages a page action works on: the picked ones, or else the page being read. */
export function targetPages(selected: number[], current: number, count: number): number[] {
  const picked = selected.filter((p) => p >= 0 && p < count);
  return picked.length ? [...new Set(picked)].sort((a, b) => a - b) : count ? [Math.min(Math.max(0, current), count - 1)] : [];
}

/**
 * The new order (old page numbers, in their new places) after moving the
 * `moving` pages, kept in their order, to just before the page that was at
 * `before` (`count` = to the end).
 */
export function moveTo(count: number, moving: number[], before: number): number[] {
  const set = new Set(moving);
  const rest = Array.from({ length: count }, (_, i) => i).filter((i) => !set.has(i));
  // Where `before` lands among the pages that stay.
  let at = rest.findIndex((i) => i >= before);
  if (at < 0) at = rest.length;
  const sorted = [...set].sort((a, b) => a - b);
  return [...rest.slice(0, at), ...sorted, ...rest.slice(at)];
}

/** The new order after moving the pages one place up (-1) or down (+1); null when they can't go further. */
export function moveBy(count: number, moving: number[], step: -1 | 1): number[] | null {
  const sorted = [...new Set(moving)].sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (step < 0) {
    if (sorted[0] === 0) return null;
    return moveTo(count, sorted, sorted[0] - 1);
  }
  const last = sorted[sorted.length - 1];
  if (last === count - 1) return null;
  // Before the page after the one that follows the last moving page.
  const after = Array.from({ length: count }, (_, i) => i).filter((i) => i > last && !sorted.includes(i))[0];
  return moveTo(count, sorted, after + 1);
}

/** True when an order changes nothing. */
export function sameOrder(order: number[]): boolean {
  return order.every((p, i) => p === i);
}

/** Where pages end up after a reorder: old page → new place. */
export function newPlaces(order: number[]): Map<number, number> {
  return new Map(order.map((old, i) => [old, i]));
}

/** "page 3", "pages 2 and 5", "4 pages" — for messages and Undo. */
export function pagesLabel(pages: number[]): string {
  if (pages.length === 1) return `page ${pages[0] + 1}`;
  if (pages.length === 2) return `pages ${pages[0] + 1} and ${pages[1] + 1}`;
  return `${pages.length} pages`;
}
