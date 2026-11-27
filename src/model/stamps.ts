/**
 * Stamps (pure): the ready-made ones ("APPROVED", "RECEIVED"…), their
 * colours, the line under the words (a name and the date), and the settings
 * remembered on this computer.
 */

export interface StampChoice {
  words: string;
  colour: string;
}

export const STAMP_COLOURS: { name: string; hex: string }[] = [
  { name: "Green", hex: "#2e7d32" },
  { name: "Blue", hex: "#1f4fa8" },
  { name: "Red", hex: "#c62828" },
  { name: "Black", hex: "#222222" },
];

const [GREEN, BLUE, RED, BLACK] = STAMP_COLOURS.map((c) => c.hex);

export const STAMPS: StampChoice[] = [
  { words: "APPROVED", colour: GREEN },
  { words: "NOT APPROVED", colour: RED },
  { words: "RECEIVED", colour: BLUE },
  { words: "REVIEWED", colour: BLUE },
  { words: "COMPLETED", colour: GREEN },
  { words: "CONFIDENTIAL", colour: RED },
  { words: "DRAFT", colour: RED },
  { words: "FINAL", colour: GREEN },
  { words: "VOID", colour: RED },
  { words: "COPY", colour: BLACK },
  { words: "FOR INFORMATION", colour: BLUE },
  { words: "AS BUILT", colour: BLUE },
];

export interface StampSettings {
  words: string;
  colour: string;
  /** Put the date under the words. */
  date: boolean;
  /** A name under the words ("" for none). */
  name: string;
}

export const DEFAULT_STAMP: StampSettings = { words: "APPROVED", colour: GREEN, date: true, name: "" };

/** The most letters a stamp's words or name can have. */
export const STAMP_MOST = 40;

/** The date as it goes on a stamp: "27 Nov 2026". */
export function stampDate(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** The stamp's words (in capitals, as stamps are) and the smaller line under them ("" for none). */
export function stampLines(s: StampSettings, now: Date): { main: string; sub: string } {
  const main = s.words.replace(/\s+/g, " ").trim().toUpperCase().slice(0, STAMP_MOST);
  const sub = [s.name.replace(/\s+/g, " ").trim().slice(0, STAMP_MOST), s.date ? stampDate(now) : ""].filter(Boolean).join(" · ");
  return { main, sub };
}

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** Settings remembered on this computer, tidied (anything odd gives the usual). */
export function cleanStamp(raw: unknown): StampSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof StampSettings, unknown>>;
  return {
    words: typeof r.words === "string" && r.words.trim() ? r.words.slice(0, STAMP_MOST) : DEFAULT_STAMP.words,
    colour: isHex(r.colour) ? r.colour : DEFAULT_STAMP.colour,
    date: typeof r.date === "boolean" ? r.date : DEFAULT_STAMP.date,
    name: typeof r.name === "string" ? r.name.slice(0, STAMP_MOST) : "",
  };
}

/** How big a stamp goes on the page at first, in "pixels" as pictures are sized (¾ of a point each): 40 points tall, at most 220 wide. */
export function stampPlacingSize(width: number, height: number): { pixelsWide: number; pixelsHigh: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const tall = Math.min(40, (220 * h) / w);
  return { pixelsWide: (tall * w) / h / 0.75, pixelsHigh: tall / 0.75 };
}
