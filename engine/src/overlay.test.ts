import { describe, expect, it } from "vitest";
import { applyOverlay, toReplacements, type Replacement, type Segment } from "./overlay";
import { anonymizeDeterministic } from "./pipeline";

/**
 * Build segments that tile `text` back-to-back (the simple case: one node per chunk, no separators).
 * Returns the segment ranges for the given chunk lengths.
 */
function tile(lengths: readonly number[]): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  for (const length of lengths) {
    segments.push({ start, end: start + length });
    start += length;
  }
  return segments;
}

describe("applyOverlay", () => {
  it("replaces a value that sits inside a single segment", () => {
    const text = "abcXYZdef";
    const segments = tile([text.length]);
    const reps: Replacement[] = [{ start: 3, end: 6, placeholder: "[P]" }];
    expect(applyOverlay(text, segments, reps)).toEqual(["abc[P]def"]);
  });

  it("emits the placeholder once and drops covered chars when a value spans segments", () => {
    // "052" | "-123" | "4567"  → value is the whole phone spanning all three segments
    const text = "052-1234567";
    const segments = tile([3, 4, 4]);
    const reps: Replacement[] = [{ start: 0, end: 11, placeholder: "[טלפון_1]" }];
    // placeholder lands in the first segment; later segments lose their covered chars
    expect(applyOverlay(text, segments, reps)).toEqual(["[טלפון_1]", "", ""]);
  });

  it("keeps the tail of a segment after a replacement ends mid-segment", () => {
    const text = "A12B";
    const segments = tile([4]);
    const reps: Replacement[] = [{ start: 1, end: 3, placeholder: "[X]" }];
    expect(applyOverlay(text, segments, reps)).toEqual(["A[X]B"]);
  });

  it("applies multiple replacements across multiple segments", () => {
    const text = "name AAA mid BBB end";
    //            0123456789...
    const segments = tile([8, 12]); // "name AAA" | " mid BBB end"
    const reps: Replacement[] = [
      { start: 5, end: 8, placeholder: "[1]" },
      { start: 13, end: 16, placeholder: "[2]" },
    ];
    expect(applyOverlay(text, segments, reps)).toEqual(["name [1]", " mid [2] end"]);
  });

  it("returns segments unchanged when there are no replacements", () => {
    const text = "hello world";
    const segments = tile([5, 6]);
    expect(applyOverlay(text, segments, [])).toEqual(["hello", " world"]);
  });
});

describe("toReplacements", () => {
  it("maps each used span to its placeholder from a real anonymize result", () => {
    const text = "ת״ז 123456709 וטלפון 052-1234567";
    const result = anonymizeDeterministic(text);
    const reps = toReplacements(text, result);
    // one rep per detected value, sorted by start, each carrying the placeholder anonymize assigned
    expect(reps.length).toBe(result.spans.length);
    expect(reps.length).toBeGreaterThanOrEqual(2); // ID + phone must actually be detected
    for (const rep of reps) {
      expect(rep.placeholder).toMatch(/^\[.+_\d+\]$/);
      expect(rep.start).toBeLessThan(rep.end);
    }
    expect([...reps].sort((a, b) => a.start - b.start)).toEqual(reps);
  });

  it("overlay of a real result reproduces the anonymized text when the whole text is one segment", () => {
    const text = "לקוח 123456709 בטלפון 052-1234567 דוא״ל a@b.co.il";
    const result = anonymizeDeterministic(text);
    const reps = toReplacements(text, result);
    const [rewritten] = applyOverlay(text, tile([text.length]), reps);
    expect(rewritten).toBe(result.anonymizedText);
  });
});
