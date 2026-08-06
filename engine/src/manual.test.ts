import { describe, expect, it } from "vitest";
import { manualSpans } from "./manual";
import { anonymizeWith } from "./pipeline";
import { restore } from "./restore";

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

  it("carries a custom label onto the span (object form) and leaves plain strings unlabeled", () => {
    const spans = manualSpans("דוד וגם דוד", [{ value: "דוד", label: "CLIENT" }]);
    expect(spans).toHaveLength(2);
    expect(spans.every((s) => s.label === "CLIENT")).toBe(true);
    expect(manualSpans("דוד", ["דוד"])[0].label).toBeUndefined();
  });
});

describe("custom manual labels", () => {
  it("emits [LABEL_n] for a named term and numbers labels independently", () => {
    const text = "התובע דוד, הנתבע יוסי, ועד דוד";
    const result = anonymizeWith(text, [
      ...manualSpans(text, [{ value: "דוד", label: "CLIENT" }]),
      ...manualSpans(text, [{ value: "יוסי", label: "TENANT" }]),
    ]);
    expect(result.anonymizedText).toContain("[CLIENT_1]");
    expect(result.anonymizedText).toContain("[TENANT_1]");
    // same value + same label dedups to ONE placeholder across occurrences
    expect(result.anonymizedText).toBe("התובע [CLIENT_1], הנתבע [TENANT_1], ועד [CLIENT_1]");
    expect(result.key.filter((r) => r.type === "MANUAL")).toHaveLength(2);
  });

  it("a labeled term still restores through the generic token matcher", () => {
    const text = "מרשי דוד כהן חתם";
    const result = anonymizeWith(text, manualSpans(text, [{ value: "דוד כהן", label: "CLIENT" }]));
    expect(result.anonymizedText).toContain("[CLIENT_1]");
    expect(restore(result.anonymizedText, result.key).restoredText).toBe(text);
  });
});

describe("anonymizeWith — excluded (reveal a false positive)", () => {
  it("drops an automatic detection whose value the user revealed (every occurrence)", () => {
    const text = "ת״ז 123456709 של הלקוח, שוב 123456709";
    const result = anonymizeWith(text, [], ["123456709"]);
    expect(result.anonymizedText).toContain("123456709"); // revealed, not redacted
    expect(result.anonymizedText).not.toContain("[ID_"); // no ID token at all
  });

  it("keeps other detections while excluding one value", () => {
    const text = "ת״ז 123456709, טלפון 052-1234567";
    const result = anonymizeWith(text, [], ["123456709"]);
    expect(result.anonymizedText).toContain("123456709"); // ID revealed
    expect(result.anonymizedText).toContain("[PHONE_1]"); // phone still redacted
  });

  it("NEVER excludes a MANUAL term — an explicit human choice always wins", () => {
    const text = "סוד וגם סוד";
    const result = anonymizeWith(text, manualSpans(text, ["סוד"]), ["סוד"]);
    expect(result.anonymizedText).toBe("[TERM_1] וגם [TERM_1]");
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
