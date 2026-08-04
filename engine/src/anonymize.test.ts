/**
 * anonymize — typed U+05F4 placeholders, per-type numbering in reading order, same value → same
 * placeholder, exact-surface key (so restore is lossless). Spans are built from substrings to keep
 * offsets honest.
 */
import { describe, expect, it } from "vitest";
import type { EntityType, Span } from "./types";
import { anonymize, placeholderFor } from "./anonymize";

/** Build a span for the first occurrence of `value` in `text`. */
function spanOf(text: string, value: string, type: EntityType, score = 1): Span {
  const start = text.indexOf(value);
  return { start, end: start + value.length, type, score };
}

describe("anonymize", () => {
  it("replaces spans with typed placeholders and emits matching key rows", () => {
    const text = "הלקוח 123456709 בטלפון 052-1234567";
    const spans = [
      spanOf(text, "123456709", "ISRAELI_ID"),
      spanOf(text, "052-1234567", "IL_PHONE"),
    ];
    const result = anonymize(text, spans);
    expect(result.anonymizedText).toBe("הלקוח [ת״ז_1] בטלפון [טלפון_1]");
    expect(result.key).toEqual([
      { placeholder: "[ת״ז_1]", original: "123456709", type: "ISRAELI_ID" },
      { placeholder: "[טלפון_1]", original: "052-1234567", type: "IL_PHONE" },
    ]);
  });

  it("gives the same placeholder to repeated identical values (one key row)", () => {
    const text = "123456709 ואז שוב 123456709";
    const spans = [
      spanOf(text, "123456709", "ISRAELI_ID"),
      { start: text.lastIndexOf("123456709"), end: text.lastIndexOf("123456709") + 9, type: "ISRAELI_ID" as EntityType, score: 1 },
    ];
    const result = anonymize(text, spans);
    expect(result.anonymizedText).toBe("[ת״ז_1] ואז שוב [ת״ז_1]");
    expect(result.key).toHaveLength(1);
  });

  it("numbers distinct values of a type by reading order", () => {
    const text = "ראשון 123456709 שני 876543208";
    const spans = [
      spanOf(text, "123456709", "ISRAELI_ID"),
      spanOf(text, "876543208", "ISRAELI_ID"),
    ];
    const result = anonymize(text, spans);
    expect(result.anonymizedText).toBe("ראשון [ת״ז_1] שני [ת״ז_2]");
  });

  it("uses gershayim U+05F4 (not ASCII quote) in abbreviation labels", () => {
    expect(placeholderFor("ISRAELI_ID", 1)).toBe("[ת״ז_1]");
    expect(placeholderFor("IL_COMPANY", 3)).toBe("[ח״פ_3]");
    expect(placeholderFor("ISRAELI_ID", 1)).not.toContain('"');
  });

  it("returns the text unchanged with an empty key when there are no spans", () => {
    const text = "אין כאן שום דבר מזהה";
    expect(anonymize(text, [])).toEqual({ anonymizedText: text, spans: [], key: [] });
  });

  it("numbers per type independently", () => {
    const text = "123456709 test@x.co.il 876543208";
    const spans = [
      spanOf(text, "123456709", "ISRAELI_ID"),
      spanOf(text, "test@x.co.il", "EMAIL_ADDRESS"),
      spanOf(text, "876543208", "ISRAELI_ID"),
    ];
    const result = anonymize(text, spans);
    expect(result.anonymizedText).toBe("[ת״ז_1] [אימייל_1] [ת״ז_2]");
  });
});
