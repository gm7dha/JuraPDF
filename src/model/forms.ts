/**
 * Filling in forms (pure): the form boxes a PDF already has, what's typed or
 * picked in them, and how each answer is named in the Undo list.
 */

/** The kinds of form box: words, a tick box, one of a set of round buttons, a drop-down list, a list to pick from. */
export type FormBoxKind = "text" | "tick" | "radio" | "choice" | "list";

/** One choice in a list: what's written into the form, and what's shown. */
export interface FormOption {
  value: string;
  label: string;
}

/**
 * One form box on a page, as pdf.js reads it. A form "field" can show in more
 * than one place (the same name): each place is one box.
 */
export interface FormBox {
  /** The field's full name in the form. */
  name: string;
  kind: FormBoxKind;
  /** Where it is, in points from the page's top-left as shown. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text: the words in it. Tick: ticked. Round button: whether this one is picked. Lists: the choices picked. */
  value: string | boolean | string[];
  /** Tick box and round button: what it means when it's on (written into the form). */
  onValue?: string;
  options?: FormOption[];
  multiline?: boolean;
  /** Can't be changed (the form says so). */
  readOnly?: boolean;
  /** A text box's most letters, if it has a limit. */
  maxLength?: number;
  /** Letter size in points (0 = fit the box). */
  fontSize?: number;
  /** Text: 0 left, 1 middle, 2 right. */
  align?: 0 | 1 | 2;
  /** A drop-down list that also takes words of your own. */
  editable?: boolean;
  /** A list where more than one can be picked. */
  several?: boolean;
  /** A secret (password) box: dots shown. */
  secret?: boolean;
  /** A date box: how its dates are written (from the form's own instructions, e.g. "dd/mm/yyyy"). */
  dateFormat?: string;
  /** Must be filled in (the form says so). */
  required?: boolean;
}

/** An answer to put in a form: words, ticked or not, or the choice(s) picked. */
export type FormValue = string | boolean | string[];

export interface Answer {
  name: string;
  value: FormValue;
}

/** One field of the form as a whole (for Claude and for summaries): its name, kind, answer and choices. */
export interface FormFieldInfo {
  name: string;
  kind: FormBoxKind | "button" | "signature";
  value: FormValue;
  /** The choices (lists), or the round buttons' values. */
  options?: string[];
  multiline?: boolean;
  readOnly?: boolean;
  /** Pages it's on, from 0. */
  pages: number[];
  /** A date box: how its dates are written. */
  dateFormat?: string;
  /** Must be filled in. */
  required?: boolean;
}

export const FORM_KIND_NAMES: Record<FormFieldInfo["kind"], string> = {
  text: "text box",
  tick: "tick box",
  radio: "set of round buttons",
  choice: "drop-down list",
  list: "list",
  button: "button",
  signature: "signature box",
};

const quoted = (s: string, most = 40) => `“${s.length > most ? `${s.slice(0, most - 1)}…` : s}”`;

/** A short, friendly name for a field ("Work order"; a dotted name's last part). */
export function fieldLabel(name: string): string {
  const last = name.split(".").filter((p) => p.trim()).pop() ?? name;
  return last.trim() || "form box";
}

/** The Undo list's name for an answer: "fill in “Name”", "tick “Agree”", "pick “Red” for “Colour”". */
export function answerLabel(kind: FormBoxKind, name: string, value: FormValue): string {
  const field = quoted(fieldLabel(name));
  if (kind === "tick") return `${value ? "tick" : "untick"} ${field}`;
  if (kind === "text") return value === "" ? `clear ${field}` : `fill in ${field}`;
  const picked = Array.isArray(value) ? value : [String(value)];
  if (!picked.length || (picked.length === 1 && picked[0] === "")) return `clear ${field}`;
  if (picked.length > 1) return `pick ${picked.length} choices for ${field}`;
  return `pick ${quoted(picked[0], 24)} for ${field}`;
}

/** Same answer? (Lists in any order.) */
export function sameValue(a: FormValue, b: FormValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = (Array.isArray(a) ? a : [a]).map(String).filter((v) => v !== "");
    const y = (Array.isArray(b) ? b : [b]).map(String).filter((v) => v !== "");
    return x.length === y.length && [...x].sort().every((v, i) => v === [...y].sort()[i]);
  }
  return a === b;
}

/**
 * Form boxes in the order Tab goes through them: page by page, top to bottom,
 * then left to right (boxes about level with each other count as one row).
 */
export function tabOrder<T extends { page: number; x: number; y: number; height: number }>(boxes: readonly T[]): T[] {
  return [...boxes].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    const row = Math.min(a.height, b.height) / 2;
    if (Math.abs(a.y - b.y) > row) return a.y - b.y;
    return a.x - b.x;
  });
}

/** The letter size to show typed words at in a box `height` points high (as PDF readers do for "fit the box"). */
export function fitFontSize(box: { height: number; fontSize?: number; multiline?: boolean }): number {
  if (box.multiline) return Math.max(4, Math.min(box.fontSize && box.fontSize > 0 ? box.fontSize : 10, 12));
  if (box.fontSize && box.fontSize > 0) return box.fontSize;
  return Math.max(4, Math.min(14, (box.height - 4) * 0.75));
}

/**
 * Turn what Claude (or anyone) gave as an answer into one for this kind of
 * field, or a problem in words. Ticks take true/false, "yes"/"no", "on"/"off";
 * lists and round buttons take one of their choices (capitals don't matter).
 */
export function answerFor(field: FormFieldInfo, given: unknown): { value: FormValue } | { problem: string } {
  const label = quoted(field.name);
  if (field.readOnly) return { problem: `${label} can't be changed (the form doesn't allow it).` };
  if (field.kind === "button" || field.kind === "signature") return { problem: `${label} is a ${FORM_KIND_NAMES[field.kind]}, which can't be filled in here.` };
  if (field.kind === "tick") {
    if (typeof given === "boolean") return { value: given };
    const t = String(given ?? "").trim().toLowerCase();
    if (["yes", "on", "true", "ticked", "tick", "checked", "x", "1"].includes(t)) return { value: true };
    if (["no", "off", "false", "unticked", "untick", "unchecked", "", "0"].includes(t)) return { value: false };
    return { problem: `${label} is a tick box: give true (ticked) or false.` };
  }
  if (field.kind === "text" && field.dateFormat && typeof given === "string") {
    const date = dateForBox(given, field.dateFormat);
    if (date === null) return { problem: `${label} is a date box: give a date as ${field.dateFormat} or yyyy-mm-dd.` };
    return { value: date };
  }
  if (field.kind === "text") {
    if (typeof given === "string") return { value: given };
    if (typeof given === "number" || typeof given === "boolean") return { value: String(given) };
    return { problem: `${label} is a text box: give the words to put in it.` };
  }
  const wanted = (Array.isArray(given) ? given : [given]).map((v) => String(v ?? "").trim());
  const options = field.options ?? [];
  const picked: string[] = [];
  for (const w of wanted) {
    if (w === "") continue;
    const match = options.find((o) => o === w) ?? options.find((o) => o.toLowerCase() === w.toLowerCase());
    if (!match) {
      if (field.kind === "choice" && field.options && wanted.length === 1) {
        // A drop-down list may take words of its own; pdf-lib says if it doesn't.
        picked.push(w);
        continue;
      }
      return { problem: `${label} has no choice ${quoted(w)}. Its choices: ${options.map((o) => quoted(o)).join(", ") || "none"}.` };
    }
    picked.push(match);
  }
  if (field.kind === "radio" || field.kind === "choice") {
    if (picked.length > 1) return { problem: `${label} takes just one choice.` };
    return { value: picked[0] ?? "" };
  }
  return { value: picked };
}

/** What pdf.js tells about one widget (a form box's drawing on a page); only the parts used here. */
interface WidgetData {
  annotationType?: number;
  subtype?: string;
  fieldType?: string;
  fieldName?: string;
  fieldValue?: unknown;
  rect?: number[];
  hidden?: boolean;
  readOnly?: boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  exportValue?: string;
  buttonValue?: string;
  options?: { exportValue?: unknown; displayValue?: unknown }[];
  combo?: boolean;
  multiSelect?: boolean;
  multiLine?: boolean;
  maxLen?: number;
  comb?: boolean;
  textAlignment?: number;
  defaultAppearanceData?: { fontSize?: number };
  password?: boolean;
  actions?: Record<string, string[]> | null;
  required?: boolean;
}

const asText = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : Array.isArray(v) ? v.map(asText).join(", ") : String(v));

/**
 * The form boxes on a page that can be filled in, from pdf.js's list of the
 * page's annotations. `toShown` turns a PDF rectangle into [x1, y1, x2, y2] as
 * shown (from the top-left, in points). Buttons, signatures, hidden and
 * nameless boxes are left out.
 */
export function formBoxesFrom(annotations: readonly unknown[], toShown: (rect: number[]) => number[]): FormBox[] {
  const boxes: FormBox[] = [];
  for (const raw of annotations) {
    const a = raw as WidgetData;
    if (a.subtype !== "Widget" || !a.fieldName || !a.rect || a.hidden) continue;
    const [x1, y1, x2, y2] = toShown(a.rect);
    const where = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    if (where.width < 1 || where.height < 1) continue;
    const common = { name: a.fieldName, ...where, readOnly: a.readOnly || undefined, required: a.required || undefined };
    if (a.fieldType === "Tx") {
      boxes.push({
        ...common,
        kind: "text",
        value: asText(a.fieldValue),
        multiline: a.multiLine || undefined,
        maxLength: a.maxLen && a.maxLen > 0 ? a.maxLen : undefined,
        fontSize: a.defaultAppearanceData?.fontSize || 0,
        align: a.textAlignment === 1 || a.textAlignment === 2 ? a.textAlignment : 0,
        secret: a.password || undefined,
        dateFormat: dateFormatIn(a.actions?.Format?.join("\n")),
      });
    } else if (a.fieldType === "Btn" && a.checkBox) {
      const on = a.exportValue ?? "Yes";
      boxes.push({ ...common, kind: "tick", onValue: on, value: asText(a.fieldValue) !== "" && asText(a.fieldValue) !== "Off" });
    } else if (a.fieldType === "Btn" && a.radioButton) {
      const on = a.buttonValue ?? "";
      boxes.push({ ...common, kind: "radio", onValue: on, value: on !== "" && asText(a.fieldValue) === on });
    } else if (a.fieldType === "Ch") {
      const options = (a.options ?? []).map((o) => ({ value: asText(o.exportValue), label: asText(o.displayValue ?? o.exportValue) }));
      const picked = (Array.isArray(a.fieldValue) ? a.fieldValue : a.fieldValue === undefined || a.fieldValue === null ? [] : [a.fieldValue]).map(asText);
      boxes.push({ ...common, kind: a.combo ? "choice" : "list", value: picked, options, several: (!a.combo && a.multiSelect) || undefined, editable: undefined });
    }
  }
  return boxes;
}

/** Ways of writing dates offered for date boxes (as Acrobat writes them: d day, m month, y year). */
export const DATE_FORMATS = ["dd/mm/yyyy", "mm/dd/yyyy", "yyyy-mm-dd", "d mmmm yyyy", "mmmm d, yyyy", "dd-mmm-yyyy"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The date format a box's own instructions give (Acrobat's AFDate_FormatEx("…") or AFDate_Format(n)), if any. */
export function dateFormatIn(script: string | undefined): string | undefined {
  if (!script) return undefined;
  const ex = /AFDate_(?:Format|Keystroke)Ex\s*\(\s*["']([^"']+)["']/.exec(script);
  if (ex) return ex[1];
  // The old numbered ones (Acrobat's list).
  const old = /AFDate_(?:Format|Keystroke)\s*\(\s*(\d+)\s*\)/.exec(script);
  const OLD = ["m/d", "m/d/yy", "mm/dd/yy", "mm/yy", "d-mmm", "d-mmm-yy", "dd-mmm-yy", "yy-mm-dd", "mmm-yy", "mmmm-yy", "mmm d, yyyy", "mmmm d, yyyy", "m/d/yy h:MM tt", "m/d/yy HH:MM"];
  return old ? OLD[Number(old[1])] : undefined;
}

/** The parts of a format: d, dd, m, mm, mmm, mmmm, yy, yyyy, and anything else as it is. */
function formatParts(format: string): string[] {
  return format.match(/d+|m+|y+|[^dmy]+/g) ?? [];
}

/** A date written in a format, e.g. (2026, 11, 28) as "dd/mm/yyyy" → "28/11/2026". */
export function writeDate(year: number, month: number, day: number, format: string): string {
  return formatParts(format)
    .map((p) => {
      if (p === "d") return String(day);
      if (p === "dd") return String(day).padStart(2, "0");
      if (p === "m") return String(month);
      if (p === "mm") return String(month).padStart(2, "0");
      if (p === "mmm") return MONTHS[month - 1].slice(0, 3);
      if (/^m{4,}$/.test(p)) return MONTHS[month - 1];
      if (p === "yy") return String(year % 100).padStart(2, "0");
      if (/^y{3,}$/.test(p)) return String(year);
      return p;
    })
    .join("");
}

/** A real day? */
function realDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Read a date written in a format, giving [year, month, day]; null when it
 * isn't one. Also takes yyyy-mm-dd, and numbers only (3/4/2026) in the
 * format's order of day and month, whatever the format.
 */
export function readDate(text: string, format: string): [number, number, number] | null {
  const exact = readDateAs(text, format);
  if (exact) return exact;
  const dayFirst = format.search(/d/) < format.search(/m/);
  return readDateAs(text.replace(/[\s.,-]+/g, "/"), dayFirst ? "d/m/yyyy" : "m/d/yyyy");
}

function readDateAs(text: string, format: string): [number, number, number] | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) {
    const [y, m, d] = iso.slice(1).map(Number);
    return realDay(y, m, d) ? [y, m, d] : null;
  }
  let y = NaN;
  let m = NaN;
  let d = NaN;
  let rest = t;
  for (const p of formatParts(format)) {
    if (/^[dmy]/.test(p)) {
      const named = /^m{3,}$/.test(p);
      const got = named ? /^[A-Za-z]+/.exec(rest) : /^\d+/.exec(rest);
      if (!got) return null;
      rest = rest.slice(got[0].length);
      if (named) {
        const i = MONTHS.findIndex((n) => n.toLowerCase().startsWith(got[0].toLowerCase().slice(0, 3)));
        if (i < 0) return null;
        m = i + 1;
      } else if (p[0] === "d") d = Number(got[0]);
      else if (p[0] === "m") m = Number(got[0]);
      else y = got[0].length <= 2 ? 2000 + Number(got[0]) : Number(got[0]);
    } else {
      // Separators: any spaces, commas, slashes or dashes will do.
      const sep = /^[\s,./-]*/.exec(rest)![0];
      rest = rest.slice(sep.length);
    }
  }
  if (rest.trim() || !realDay(y, m, d)) return null;
  return [y, m, d];
}

/** A date for a box with this format: written the box's way, from either its own way or yyyy-mm-dd; null when it isn't a date. */
export function dateForBox(text: string, format: string): string | null {
  if (!text.trim()) return "";
  const got = readDate(text, format);
  return got ? writeDate(got[0], got[1], got[2], format) : null;
}

/** A list's choice as pdf-lib knows it (by what's shown), from what's written in the form (or shown). */
export function optionLabel(box: Pick<FormBox, "options">, value: string): string {
  return box.options?.find((o) => o.value === value)?.label ?? value;
}
