import { describe, expect, it } from "vitest";

import { detectPlatform, helpRows, shortcut } from "../src/app/platform";
import { safeFileName } from "../src/app/download";

describe("platform", () => {
  it("shows shortcuts the way each keyboard labels them", () => {
    expect(detectPlatform({ platform: "MacIntel" })).toBe("mac");
    expect(detectPlatform({ platform: "Win32" })).toBe("windows");
    expect(shortcut("mac", "S")).toBe("⌘S");
    expect(shortcut("windows", "S", { shift: true })).toBe("Ctrl+Shift+S");
    expect(helpRows("mac").keys.some(([k]) => k.includes("⌘"))).toBe(true);
  });

  it("makes names safe for files", () => {
    expect(safeFileName('Report: "final"?')).toBe("Report final");
    expect(safeFileName("   ")).toBe("Document");
  });
});
