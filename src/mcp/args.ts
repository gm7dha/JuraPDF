/**
 * Checking what Claude sends to the JuraPDF tools, with plain-English
 * messages that say what was wrong and how to put it right.
 */

/** A problem with a tool's input: the message is shown to Claude as it is. */
export class InputError extends Error {}

export type Obj = Record<string, unknown>;

export function object(v: unknown, where: string): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new InputError(`${where} should be an object like {"track": …}.`);
  return v as Obj;
}

/** Turn 0.30000000000000004 into 0.3 so saved songs stay tidy. */
export const r6 = (n: number) => Math.round(n * 1e6) / 1e6 || 0;

/** A number, inside its limits. */
export function num(v: unknown, where: string, opts: { min?: number; max?: number; integer?: boolean; fallback?: number } = {}): number {
  if ((v === undefined || v === null) && opts.fallback !== undefined) return opts.fallback;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  const range = opts.min !== undefined && opts.max !== undefined ? ` from ${opts.min} to ${opts.max}` : opts.min !== undefined ? ` of at least ${opts.min}` : opts.max !== undefined ? ` of at most ${opts.max}` : "";
  if (!Number.isFinite(n)) throw new InputError(`${where} ${v === undefined || v === null ? "is missing: give" : "must be"} a ${opts.integer ? "whole " : ""}number${range}.`);
  if (opts.integer && !Number.isInteger(n)) throw new InputError(`${where} must be a whole number (got ${n}).`);
  if ((opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) throw new InputError(`${where} must be a number${range} (got ${r6(n)}).`);
  return n;
}

export function optionalNum(v: unknown, where: string, opts: Parameters<typeof num>[2] = {}): number | undefined {
  return v === undefined || v === null ? undefined : num(v, where, opts);
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], where: string, fallback?: T): T {
  if ((v === undefined || v === null) && fallback !== undefined) return fallback;
  if (typeof v === "string") {
    const hit = allowed.find((a) => a.toLowerCase() === v.trim().toLowerCase());
    if (hit) return hit;
  }
  const shown = v === undefined ? "nothing" : JSON.stringify(v);
  throw new InputError(`${where} must be one of ${allowed.map((a) => `"${a}"`).join(", ")} (got ${shown}).`);
}

export function bool(v: unknown, where: string, fallback = false): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  throw new InputError(`${where} must be true or false.`);
}

export function text(v: unknown, where: string, fallback?: string): string {
  if ((v === undefined || v === null || v === "") && fallback !== undefined) return fallback;
  if (typeof v !== "string" || !v.trim()) throw new InputError(`${where} should be some text.`);
  return v.trim().slice(0, 200);
}

export function list(v: unknown, where: string, opts: { allowEmpty?: boolean } = {}): unknown[] {
  if (v === undefined || v === null) {
    if (opts.allowEmpty) return [];
    throw new InputError(`${where} is missing: give a list.`);
  }
  const arr = Array.isArray(v) ? v : [v];
  if (!arr.length && !opts.allowEmpty) throw new InputError(`${where} is empty: give at least one.`);
  return arr;
}

/** Complain about keys the tool doesn't know (usually a typo), naming the ones it does. */
export function noExtras(o: Obj, known: readonly string[], where: string): void {
  const extra = Object.keys(o).filter((k) => !known.includes(k));
  if (extra.length) {
    throw new InputError(`${where}: ${extra.map((k) => `"${k}"`).join(", ")} ${extra.length > 1 ? "aren't settings" : "isn't a setting"} here. The settings are: ${known.join(", ")}.`);
  }
}
