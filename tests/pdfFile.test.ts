import { describe, expect, it } from "vitest";

import { isPdfName, looksLikePdf, nameFromFileName, paperName, sizeLabel } from "../src/model/pdfFile";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("PDF files", () => {
  it("recognises a PDF by what's inside", () => {
    expect(looksLikePdf(bytes("%PDF-1.7\n..."))).toBe(true);
    // Some PDFs have a little junk before the header; readers allow it.
    expect(looksLikePdf(bytes("\uFEFFjunk%PDF-1.4"))).toBe(true);
    expect(looksLikePdf(bytes("PK\u0003\u0004 a zip file"))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });

  it("names a PDF from its file name", () => {
    expect(nameFromFileName("Quarterly report.PDF")).toBe("Quarterly report");
    expect(nameFromFileName("C:\\Users\\me\\Letter.pdf")).toBe("Letter");
    expect(nameFromFileName(".pdf")).toBe("Untitled");
    expect(isPdfName("a.pdf")).toBe(true);
    expect(isPdfName("a.pdf.zip")).toBe(false);
  });

  it("describes sizes in plain words", () => {
    expect(sizeLabel(900)).toBe("900 bytes");
    expect(sizeLabel(820 * 1024)).toBe("820 KB");
    expect(sizeLabel(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(paperName(595.28, 841.89)).toBe("A4");
    expect(paperName(841.89, 595.28)).toBe("A4 landscape");
    expect(paperName(612, 792)).toBe("Letter");
    expect(paperName(283.46, 283.46)).toBe("100 × 100 mm");
  });
});
