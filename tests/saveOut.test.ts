import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { documentText, pageText } from "../src/model/textOut";
import { crc32, makeZip } from "../src/model/zip";
import { insertPictures } from "../src/pdf/pages";

/** A 2×1 pixel red PNG. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAN/gH/w+1JvwAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

describe("zip files", () => {
  it("check each file the standard way", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("hold the files, listed at the end", () => {
    const a = new TextEncoder().encode("hello");
    const b = new Uint8Array([1, 2, 3]);
    const zip = makeZip([{ name: "a.txt", bytes: a }, { name: "page 2.png", bytes: b }], new Date(2026, 10, 25, 9, 30));
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(zip.subarray(30, 35))).toBe("a.txt");
    expect(new TextDecoder().decode(zip.subarray(35, 40))).toBe("hello");
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const central = v.getUint32(end + 16, true);
    expect(v.getUint32(central, true)).toBe(0x02014b50);
    // The second file's entry points at its own start.
    const second = central + 46 + 5;
    expect(v.getUint32(second, true)).toBe(0x02014b50);
    expect(v.getUint32(second + 42, true)).toBe(30 + 5 + 5);
    expect(v.getUint32(second + 16, true)).toBe(crc32(b));
  });
});

describe("the words as text", () => {
  it("keeps lines, and tidies spaces and gaps", () => {
    expect(pageText([{ str: "Hello", hasEOL: false }, { str: " world  ", hasEOL: true }, { str: "", hasEOL: true }, { str: "", hasEOL: true }, { str: "", hasEOL: true }, { str: "Bye" }])).toBe("Hello world\n\nBye");
  });

  it("puts each page under a heading", () => {
    expect(documentText([{ page: 1, text: "One" }, { page: 2, text: "" }])).toBe("--- Page 1 ---\nOne\n\n--- Page 2 ---\n(no words on this page)\n");
  });
});

describe("pictures brought in as pages", () => {
  it("each get a page like those around them, turned to suit, the picture filling it", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    const bytes = await insertPictures(await doc.save(), [{ bytes: PNG, type: "png", name: "wide.png" }], 1);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(3);
    const { width, height } = out.getPage(1).getSize();
    expect([width, height]).toEqual([842, 595]);
    const pdf = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
    const list = await (await pdf.getPage(2)).getOperatorList();
    expect(list.fnArray.filter((f) => f === OPS.paintImageXObject)).toHaveLength(1);
  });

  it("match a turned page's shape as it shows", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).setRotation(degrees(90));
    const bytes = await insertPictures(await doc.save(), [{ bytes: PNG, type: "png", name: "wide.png" }], 1);
    const page = (await PDFDocument.load(bytes)).getPage(1);
    expect([page.getSize().width, page.getSize().height]).toEqual([842, 595]);
  });
});
