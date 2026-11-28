import { describe, expect, it } from "vitest";

import { changeLine, changesBetween, changesText, compareLists, compareSummary, noteFor, wordsIn, type Step } from "../src/model/compare";

const words = (text: string, page = 0) => wordsIn([{ str: text }], page);

/** Apply steps to `a` and check they give `b`, and how many differences they take. */
function check(a: string[], b: string[]): number {
  const steps = compareLists(a, b) as Step[];
  const out: string[] = [];
  let changes = 0;
  let ia = 0;
  let ib = 0;
  for (const s of steps) {
    if (s.op === "same") {
      expect(s.a).toBe(ia++);
      expect(s.b).toBe(ib++);
      expect(a[s.a]).toBe(b[s.b]);
      out.push(a[s.a]);
    } else if (s.op === "out") {
      expect(s.a).toBe(ia++);
      changes++;
    } else {
      expect(s.b).toBe(ib++);
      out.push(b[s.b]);
      changes++;
    }
  }
  expect(ia).toBe(a.length);
  expect(ib).toBe(b.length);
  expect(out).toEqual(b);
  return changes;
}

describe("comparing lists of words", () => {
  it("finds the fewest differences", () => {
    expect(check([], [])).toBe(0);
    expect(check(["a"], [])).toBe(1);
    expect(check([], ["a", "b"])).toBe(2);
    expect(check("abcabba".split(""), "cbabac".split(""))).toBe(5);
    expect(check("the quick brown fox".split(" "), "the slow brown fox jumps".split(" "))).toBe(3);
    expect(check("a b c d e".split(" "), "a b c d e".split(" "))).toBe(0);
    expect(check("x a b c".split(" "), "a b c y".split(" "))).toBe(2);
  });

  it("works on random lists", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: Math.floor(rnd() * 30) }, () => "abcd"[Math.floor(rnd() * 4)]);
      const b = Array.from({ length: Math.floor(rnd() * 30) }, () => "abcd"[Math.floor(rnd() * 4)]);
      check(a, b);
    }
  });

  it("gives up when too much is different", () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
    expect(compareLists(a, b, 20)).toBeNull();
    expect(compareLists(a, b)).not.toBeNull();
  });
});

describe("words on a page", () => {
  it("splits on spaces and line ends, and a word can run across bits", () => {
    const got = wordsIn(
      [
        { str: "Hello wor" },
        { str: "ld", hasEOL: true },
        { str: "next  line" },
      ],
      2,
    );
    expect(got.map((w) => w.text)).toEqual(["Hello", "world", "next", "line"]);
    expect(got[1].pieces).toEqual([
      { bit: 0, from: 6, to: 9 },
      { bit: 1, from: 0, to: 2 },
    ]);
    expect(got[0].page).toBe(2);
  });

  it("compares curly quotes and dashes as plain ones", () => {
    const a = words("it’s “fine” — really");
    const b = words("it's \"fine\" - really");
    expect(changesBetween(a, b)).toEqual([]);
  });
});

describe("changes between two files", () => {
  it("gathers words put in, taken out and changed", () => {
    const other = [...words("The quick brown fox jumps over the dog."), ...words("Second page words here.", 1)];
    const mine = [...words("The slow brown fox jumps over the lazy dog."), ...words("Second page here.", 1)];
    const changes = changesBetween(other, mine)!;
    expect(changes.map((c) => [c.kind, c.was, c.now, c.page])).toEqual([
      ["changed", "quick", "slow", 0],
      ["added", "", "lazy", 0],
      ["removed", "words", "", 1],
    ]);
    expect(changes[2].near?.text).toBe("page");
    expect(changes[2].nearIsAfter).toBe(false);
    expect(changes[2].otherPage).toBe(1);
    expect(changes[1].words.map((w) => w.text)).toEqual(["lazy"]);
  });

  it("points to the word after words taken out at the very start", () => {
    const [c] = changesBetween(words("Draft: the plan"), words("the plan"))!;
    expect(c.kind).toBe("removed");
    expect(c.near?.text).toBe("the");
    expect(c.nearIsAfter).toBe(true);
  });

  it("describes them in plain words", () => {
    const changes = changesBetween(words("a b c d"), words("a x c d e"))!;
    expect(compareSummary(changes, "old.pdf")).toBe("2 differences from old.pdf: 1 put in, 1 changed.");
    expect(compareSummary([], "old.pdf")).toBe("The words in this PDF and old.pdf are the same.");
    expect(compareSummary(null, "old.pdf")).toMatch(/too different/);
    expect(changeLine(changes[0])).toBe("“b” → “x”");
    expect(changeLine(changes[1])).toBe("Put in: “e”");
    expect(changeLine({ kind: "removed", was: "gone", now: "" })).toBe("Taken out: “gone”");
    expect(noteFor(changes[1], "old.pdf")).toBeNull();
    expect(noteFor(changes[0], "old.pdf")).toBe("Changed. In old.pdf this was: “b”");
    expect(changesText(changes, "old.pdf").split("\n")[1]).toBe("- Page 1 (page 1 in old.pdf): “b” → “x”");
  });
});
