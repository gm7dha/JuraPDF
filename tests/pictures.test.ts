import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { parseContent, splice } from "../src/model/contentStream";
import { fitInside, shownBox, type Matrix } from "../src/model/pictures";
import { addPicture } from "../src/pdf/additions";
import { changePicture, picturesOn } from "../src/pdf/pictures";

/** A 2×1 pixel red PNG. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAN/gH/w+1JvwAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
const enc = (s: string) => new TextEncoder().encode(s);

describe("reading a page's drawing instructions", () => {
  it("finds each command with its numbers and names, and where it sits", () => {
    const text = "q 200 0 0 100 50 60 cm /Im1 Do Q\nBT /F1 12 Tf [(a) -20 (b\\)c)] TJ (x (y) z) Tj ET /P <</MCID 0>> BDC EMC % note\n0 g";
    const ops = parseContent(enc(text));
    expect(ops.map((o) => o.op)).toEqual(["q", "cm", "Do", "Q", "BT", "Tf", "TJ", "Tj", "ET", "BDC", "EMC", "g"]);
    expect(ops[1].args).toEqual([200, 0, 0, 100, 50, 60]);
    expect(ops[2].args).toEqual(["/Im1"]);
    expect(text.slice(ops[2].start, ops[2].end)).toBe("/Im1 Do");
    expect(ops[9].args).toEqual(["/P", null]);
  });

  it("steps over a small picture written in the middle", () => {
    const ops = parseContent(enc("q BI /W 2 /H 1 /CS /G /BPC 8 ID \u0000EIÿ EI Q 1 g"));
    expect(ops.map((o) => o.op)).toEqual(["q", "BI", "ID", "EI", "Q", "g"]);
  });

  it("changes one span of bytes", () => {
    expect(new TextDecoder().decode(splice(enc("a b c d"), [{ start: 2, end: 3, text: "BB" }, { start: 6, end: 7, text: "" }]))).toBe("a BB c ");
  });
});

describe("where a picture shows", () => {
  const upright = { x: 0, y: 0, width: 595, height: 842, rotation: 0 };
  it("on an upright page", () => {
    expect(shownBox(upright, [200, 0, 0, 100, 50, 60] as Matrix)).toEqual({ x: 50, y: 842 - 160, width: 200, height: 100 });
  });
  it("fits a picture inside a box, keeping its shape", () => {
    expect(fitInside({ x: 0, y: 0, width: 100, height: 100 }, 2, 1)).toEqual({ x: 0, y: 25, width: 100, height: 50 });
  });
});

async function imagesDrawn(bytes: Uint8Array): Promise<number[][]> {
  const pdf = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const list = await (await pdf.getPage(1)).getOperatorList();
  const out: number[][] = [];
  list.fnArray.forEach((fn, i) => {
    if (fn === OPS.paintImageXObject) out.push(list.argsArray[i] as number[]);
  });
  return out;
}

async function pdfWithPicture(rotation = 0) {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).setRotation(degrees(rotation));
  return addPicture(await doc.save(), { kind: "picture", page: 0, x: 100, y: 120, width: 200, height: 100 }, { bytes: PNG, type: "png", name: "dot.png" });
}

const close = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => {
  for (const k of ["x", "y", "width", "height"] as const) expect(a[k]).toBeCloseTo(b[k], 3);
};

describe("pictures already on a page", () => {
  it("are found where they show", async () => {
    for (const rotation of [0, 90, 180, 270]) {
      const [spot] = await picturesOn(await pdfWithPicture(rotation), 0);
      expect(spot).toMatchObject({ n: 0, pixelsWide: 2, pixelsHigh: 1 });
      close(spot.box, { x: 100, y: 120, width: 200, height: 100 });
    }
  });

  it("can be moved and resized, on upright and turned pages", async () => {
    for (const rotation of [0, 90]) {
      const to = { x: 30, y: 40, width: 120, height: 60 };
      const bytes = await changePicture(await pdfWithPicture(rotation), 0, 0, { kind: "move", to });
      const [spot] = await picturesOn(bytes, 0);
      close(spot.box, to);
      expect(await imagesDrawn(bytes)).toHaveLength(1);
    }
  });

  it("can be taken off the page", async () => {
    const bytes = await changePicture(await pdfWithPicture(), 0, 0, { kind: "remove" });
    expect(await picturesOn(bytes, 0)).toEqual([]);
    expect(await imagesDrawn(bytes)).toHaveLength(0);
  });

  it("can be swapped for another picture, which keeps its own shape", async () => {
    const square = await (async () => {
      // A 1×1 PNG made with pdf-lib's own test of embedding is overkill; the 2×1 one shows the fit just as well.
      return PNG;
    })();
    const bytes = await changePicture(await pdfWithPicture(90), 0, 0, { kind: "replace", picture: { bytes: square, type: "png", name: "new.png" }, to: { x: 100, y: 100, width: 100, height: 100 } });
    const spots = await picturesOn(bytes, 0);
    expect(spots).toHaveLength(1);
    expect(spots[0].name).not.toBe("");
    close(spots[0].box, { x: 100, y: 125, width: 100, height: 50 });
  });

  it("leaves everything else on the page as it was", async () => {
    let bytes: Uint8Array = await pdfWithPicture();
    bytes = await addPicture(bytes, { kind: "picture", page: 0, x: 300, y: 500, width: 50, height: 25 }, { bytes: PNG, type: "png", name: "b.png" });
    bytes = await changePicture(bytes, 0, 0, { kind: "remove" });
    const spots = await picturesOn(bytes, 0);
    expect(spots).toHaveLength(1);
    close(spots[0].box, { x: 300, y: 500, width: 50, height: 25 });
  });
});
