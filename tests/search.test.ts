import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { findOnPage, firstAtOrAfter, foldQuery, hitsOnPage, noWordsNote, pageWords, searchCount, stepHit, type SearchHit } from "../src/model/search";
import type { TextBit } from "../src/model/textOut";
import { addHiddenWords } from "../src/pdf/additions";
import { addBlankPage } from "../src/pdf/pages";

/** Find `query` among bits, the way the search bar does, giving each hit's letters back as text. */
function find(bits: TextBit[], query: string, matchCase = false): string[] {
  const hits = findOnPage(pageWords(bits, matchCase), foldQuery(query, matchCase), 0);
  return hits.map((h) => h.pieces.map((p) => bits[p.bit].str.slice(p.from, p.to)).join("|"));
}

describe("finding words on a page", () => {
  it("ignores capitals unless asked", () => {
    const bits = [{ str: "Work Order W245 and work order w246", hasEOL: false }];
    expect(find(bits, "work order")).toEqual(["Work Order", "work order"]);
    expect(find(bits, "Work Order", true)).toEqual(["Work Order"]);
    expect(find(bits, "WORK ORDER", true)).toEqual([]);
  });

  it("finds every place, one after another", () => {
    expect(find([{ str: "aaaa", hasEOL: false }], "aa")).toEqual(["aa", "aa"]);
    expect(find([{ str: "banana", hasEOL: false }], "an")).toEqual(["an", "an"]);
  });

  it("finds words split over several bits and lines, and marks just their letters", () => {
    const bits = [
      { str: "Total am", hasEOL: false },
      { str: "ount due", hasEOL: true },
      { str: "now", hasEOL: false },
    ];
    expect(find(bits, "amount")).toEqual(["am|ount"]);
    expect(find(bits, "due now")).toEqual(["due|now"]);
  });

  it("doesn't mind accents, curly quotes, dashes or extra spaces", () => {
    expect(find([{ str: "Café crème", hasEOL: false }], "cafe creme")).toEqual(["Café crème"]);
    expect(find([{ str: "Kevin’s file – v2", hasEOL: false }], "kevin's file - v2")).toEqual(["Kevin’s file – v2"]);
    expect(find([{ str: "two   spaces", hasEOL: false }], "two spaces")).toEqual(["two   spaces"]);
    expect(find([{ str: "two", hasEOL: false }, { str: " ", hasEOL: false }, { str: "bits", hasEOL: false }], "  two   bits ")).toEqual(["two| |bits"]);
    // Ligatures as one letter ("ﬁ") still match the two letters typed.
    expect(find([{ str: "ﬁle", hasEOL: false }], "file")).toEqual(["ﬁle"]);
  });

  it("finds nothing for nothing typed, and says when a page has no words", () => {
    expect(find([{ str: "words", hasEOL: false }], "   ")).toEqual([]);
    expect(pageWords([], false).hasWords).toBe(false);
    expect(pageWords([{ str: " ", hasEOL: true }], false).hasWords).toBe(false);
    expect(pageWords([{ str: "x", hasEOL: false }], false).hasWords).toBe(true);
  });
});

describe("moving between places found", () => {
  const hits: SearchHit[] = [0, 2, 2, 5].map((page) => ({ page, pieces: [] }));

  it("finds a page's hits", () => {
    expect(hitsOnPage(hits, 2)).toEqual([1, 3]);
    expect(hitsOnPage(hits, 3)).toEqual([3, 3]);
    expect(firstAtOrAfter(hits, 3)).toBe(3);
    expect(firstAtOrAfter(hits, 6)).toBe(4);
  });

  it("goes round from the last to the first, and starts from the page being read", () => {
    expect(stepHit(3, 4, 1, 0, hits)).toBe(0);
    expect(stepHit(0, 4, -1, 0, hits)).toBe(3);
    expect(stepHit(-1, 4, 1, 3, hits)).toBe(3);
    expect(stepHit(-1, 4, -1, 3, hits)).toBe(2);
    expect(stepHit(-1, 4, 1, 9, hits)).toBe(0);
    expect(stepHit(-1, 0, 1, 0, [])).toBe(-1);
  });

  it("says how many it found", () => {
    const base = { query: "x", hits, current: 1, read: 6, total: 6 };
    expect(searchCount(base)).toBe("2 of 4");
    expect(searchCount({ ...base, read: 3 })).toBe("2 of 4+");
    expect(searchCount({ ...base, hits: [], current: -1 })).toBe("Not found");
    expect(searchCount({ ...base, hits: [], current: -1, read: 2 })).toBe("Looking… page 3 of 6");
    expect(searchCount({ ...base, query: " " })).toBe("");
  });

  it("explains pages with no words kindly", () => {
    expect(noWordsNote([], 5, false)).toBe("");
    expect(noWordsNote([0, 1], 2, false)).toMatch(/^This PDF has no words to look through/);
    expect(noWordsNote([0], 1, false)).toMatch(/^This page has no words/);
    expect(noWordsNote([2], 5, false)).toBe("Page 3 has no words to look through (a scan, a photo or a blank page), so the words may be there in a picture.");
    expect(noWordsNote([2], 5, true)).toBe("");
    expect(noWordsNote([2, 3], 5, true)).toBe("Pages 3 and 4 have no words to look through (a scan, a photo or a blank page).");
    expect(noWordsNote([0, 2, 4], 9, false)).toMatch(/^Pages 1, 3 and 5 have .*may be there in a picture\.$/);
    expect(noWordsNote([0, 1, 2, 3, 4], 9, true)).toMatch(/^5 pages have/);
  });
});

/** Every page's bits as pdf.js gives them (the same ones the words layer is built from). */
async function bitsOf(bytes: Uint8Array): Promise<TextBit[][]> {
  const pdf = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const out: TextBit[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const items = (await (await pdf.getPage(i)).getTextContent()).items;
    out.push(items.filter((x) => "str" in x).map((x) => ({ str: (x as { str: string }).str, hasEOL: !!(x as { hasEOL?: boolean }).hasEOL })));
  }
  return out;
}

describe("finding words in real PDFs", () => {
  it("finds words on every page, words read from pictures, and pages with none", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const one = doc.addPage([595, 842]);
    one.drawText("Work Order W245354", { x: 50, y: 780, size: 14, font });
    one.drawText("Checked by Kevin, work order closed.", { x: 50, y: 750, size: 12, font });
    doc.addPage([595, 842]); // a scan: no words yet
    doc.addPage([595, 842]).drawText("Second WORK ORDER", { x: 50, y: 780, size: 14, font });
    let bytes: Uint8Array = await doc.save();

    const look = async (query: string) => {
      const pages = await bitsOf(bytes);
      return {
        hits: pages.flatMap((bits, p) => findOnPage(pageWords(bits, false), foldQuery(query, false), p)),
        noWords: pages.flatMap((bits, p) => (pageWords(bits, false).hasWords ? [] : [p])),
        pages,
      };
    };
    let r = await look("work order");
    expect(r.hits.map((h) => h.page)).toEqual([0, 0, 2]);
    expect(r.noWords).toEqual([1]);
    // The pieces point at the very letters, so the highlight lands on them.
    for (const h of r.hits) expect(h.pieces.map((p) => r.pages[h.page][p.bit].str.slice(p.from, p.to)).join("").toLowerCase()).toBe("work order");

    // Words read from the scanned page (written invisibly) are found too.
    bytes = await addHiddenWords(bytes, 1, [
      { text: "work", x: 75, y: 150, width: 50, height: 20 },
      { text: "order", x: 130, y: 150, width: 60, height: 20 },
    ]);
    // A page brought in or added later changes nothing for the others.
    bytes = await addBlankPage(bytes, 2);
    r = await look("work order");
    expect(r.hits.map((h) => h.page)).toEqual([0, 0, 1, 3]);
    expect(r.noWords).toEqual([2]);
  });
});
