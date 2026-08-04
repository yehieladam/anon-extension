/**
 * Occurrence completion — the fix for NER tagging only some occurrences of a repeated value. A value
 * detected once must be redacted everywhere, but never inside a longer word that merely contains it.
 */
import { describe, expect, it } from "vitest";
import { completeOccurrences } from "./occurrences";
import type { Span } from "./types";

const span = (start: number, end: number, type: Span["type"] = "PERSON"): Span => ({
  start,
  end,
  type,
  score: 0.99,
});

describe("completeOccurrences", () => {
  it("adds the untagged repeat occurrence of a name", () => {
    const text = "משה כהן דיבר. מאוחר יותר משה כהן חתם.";
    // Only the FIRST occurrence is tagged.
    const added = completeOccurrences(text, [span(0, 7)]);
    const surfaces = added.map((s) => text.slice(s.start, s.end));
    expect(surfaces).toEqual(["משה כהן", "משה כהן"]);
    // Both carry the original type/score.
    expect(added.every((s) => s.type === "PERSON" && s.score === 0.99)).toBe(true);
  });

  it("never redacts a short value inside a longer word that contains it", () => {
    // "ישראל" must not match inside "ישראלי" (trailing Hebrew letter) — word-bounded.
    const text = "ישראל גר בישראל אבל ישראלי הוא שם משפחה";
    const added = completeOccurrences(text, [span(0, 5, "LOCATION")]);
    const surfaces = added.map((s) => text.slice(s.start, s.end));
    // Two standalone "ישראל" (index 0 and inside "בישראל"? no — preceded by ב, not whole word).
    // Whole-word occurrences only: the leading standalone one. "בישראל" (ב prefix) and "ישראלי"
    // (י suffix) are both excluded.
    expect(surfaces).toEqual(["ישראל"]);
  });

  it("keeps a value adjacent to punctuation or digits (non-letter boundaries count as word breaks)", () => {
    const text = "לקוח: משה כהן, מספר 5";
    const added = completeOccurrences(text, [span(6, 13)]);
    expect(added.map((s) => text.slice(s.start, s.end))).toEqual(["משה כהן"]);
  });

  it("dedupes identical (value,type) so scanning is done once per value", () => {
    const text = "רון בא. רון הלך.";
    // Two spans of the SAME value+type — must be scanned once, not doubled.
    const added = completeOccurrences(text, [span(0, 3), span(8, 11)]);
    // "רון" appears twice as a whole word; returned twice (not four times).
    expect(added.map((s) => text.slice(s.start, s.end))).toEqual(["רון", "רון"]);
  });

  it("returns nothing for an empty-surface span", () => {
    expect(completeOccurrences("abc", [span(1, 1)])).toEqual([]);
  });
});
