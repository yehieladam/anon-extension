/**
 * pipeline — deterministic detect→resolve→anonymize, and the full merge with NER spans.
 */
import { describe, expect, it } from "vitest";
import type { Span } from "./types";
import {
  anonymizeDeterministic,
  anonymizeFull,
  anonymizeManualOnly,
  detectDeterministic,
} from "./pipeline";
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
    expect(result.anonymizedText).toContain("[ID_1]");
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
    expect(result.anonymizedText).toContain("[NAME_1]");
    expect(result.anonymizedText).toContain("[ID_1]");
    expect(restore(result.anonymizedText, result.key).restoredText).toBe(text);
  });
});

describe("anonymizeManualOnly", () => {
  it("redacts ONLY the chosen terms and leaves auto-detected PII untouched", () => {
    // Deterministic PII (a valid ID) is present, but manual-only must NOT touch it.
    const text = "הלקוח דוד כהן, ת״ז 123456709, גר ברחוב הרצל";
    const result = anonymizeManualOnly(text, ["דוד כהן", "הרצל"]);
    expect(result.anonymizedText).toContain("[TERM_1]"); // דוד כהן
    expect(result.anonymizedText).toContain("[TERM_2]"); // הרצל
    expect(result.anonymizedText).toContain("123456709"); // the ID is left as-is (no auto-detection)
    expect(result.anonymizedText).not.toContain("דוד כהן");
    expect(restore(result.anonymizedText, result.key).restoredText).toBe(text);
  });

  it("redacts every occurrence of a chosen term", () => {
    const result = anonymizeManualOnly("כהן פגש את כהן", ["כהן"]);
    expect(result.anonymizedText).toBe("[TERM_1] פגש את [TERM_1]");
  });

  it("returns the text unchanged with an empty key when no terms are given", () => {
    const result = anonymizeManualOnly("שום דבר לא נבחר", []);
    expect(result.anonymizedText).toBe("שום דבר לא נבחר");
    expect(result.key).toEqual([]);
  });
});
