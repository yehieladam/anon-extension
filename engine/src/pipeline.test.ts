/**
 * pipeline — deterministic detect→resolve→anonymize, and the full merge with NER spans.
 */
import { describe, expect, it } from "vitest";
import type { Span } from "./types";
import { anonymizeDeterministic, anonymizeFull, detectDeterministic } from "./pipeline";
import { restore } from "./restore";

const DOC = "הלקוח ת״ז 123456709, טלפון 052-1234567, דוא״ל cohen.law@office.co.il";

describe("detectDeterministic", () => {
  it("finds the ID, phone and email across recognizers", () => {
    const types = new Set(detectDeterministic(DOC).map((s) => s.type));
    expect(types).toContain("ISRAELI_ID");
    expect(types).toContain("IL_PHONE");
    expect(types).toContain("EMAIL_ADDRESS");
  });
});

describe("anonymizeDeterministic", () => {
  it("anonymizes and restores byte-exact (no model)", () => {
    const result = anonymizeDeterministic(DOC);
    expect(result.anonymizedText).toContain("[ת״ז_1]");
    expect(result.anonymizedText).not.toContain("123456709");
    expect(restore(result.anonymizedText, result.key).restoredText).toBe(DOC);
  });
});

describe("anonymizeFull", () => {
  it("merges NER spans and lets deterministic outrank them on overlap", () => {
    const text = "עורך הדין דוד כהן, ת״ז 123456709";
    // Simulated NER output (name) alongside the deterministic ID.
    const nerName: Span = {
      start: text.indexOf("דוד כהן"),
      end: text.indexOf("דוד כהן") + "דוד כהן".length,
      type: "PERSON",
      score: 0.99,
    };
    const result = anonymizeFull(text, [nerName]);
    expect(result.anonymizedText).toContain("[שם_1]");
    expect(result.anonymizedText).toContain("[ת״ז_1]");
    expect(restore(result.anonymizedText, result.key).restoredText).toBe(text);
  });
});
