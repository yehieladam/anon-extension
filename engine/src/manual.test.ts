import { describe, expect, it } from "vitest";
import { manualSpans } from "./manual";
import { anonymizeWith } from "./pipeline";

describe("manualSpans", () => {
  it("finds every occurrence of each term", () => {
    const text = "פרץ ושות׳ בע״מ, עו״ד פרץ";
    const spans = manualSpans(text, ["פרץ"]);
    expect(spans).toHaveLength(2);
    expect(spans.every((s) => s.type === "MANUAL" && s.score === 1)).toBe(true);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("פרץ");
  });

  it("ignores empty/whitespace terms", () => {
    expect(manualSpans("abc", ["", "  "])).toHaveLength(0);
  });
});

describe("anonymizeWith — manual terms", () => {
  it("redacts a manual term the detectors would miss, and it wins overlaps", () => {
    const text = "חברת פרץ ושות׳, טלפון 052-1234567";
    const result = anonymizeWith(text, manualSpans(text, ["פרץ ושות׳"]));
    expect(result.anonymizedText).toContain("[TERM_1]");
    expect(result.anonymizedText).not.toContain("פרץ ושות׳");
    expect(result.anonymizedText).toContain("[PHONE_1]"); // deterministic still works alongside
    // the key round-trips the manual value for restore
    expect(result.key.some((r) => r.type === "MANUAL" && r.original === "פרץ ושות׳")).toBe(true);
  });
});
