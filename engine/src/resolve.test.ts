/**
 * resolveOverlaps — keep-strongest greedy resolution. Covers: deterministic beats NER (ID inside
 * a PERSON span), adjacent spans both survive, higher score/length wins within a priority, output
 * is non-overlapping and in reading order, and equal-strength overlaps collapse to one.
 */
import { describe, expect, it } from "vitest";
import type { Span } from "./types";
import { resolveOverlaps } from "./resolve";

const span = (start: number, end: number, type: Span["type"], score = 1): Span => ({
  start,
  end,
  type,
  score,
});

describe("resolveOverlaps", () => {
  it("keeps a deterministic ID over a PERSON span it sits inside", () => {
    const person = span(0, 20, "PERSON", 0.99);
    const id = span(5, 14, "ISRAELI_ID", 1);
    expect(resolveOverlaps([person, id])).toEqual([id]);
  });

  it("keeps adjacent (touching, non-overlapping) spans, in reading order", () => {
    const a = span(0, 5, "PERSON", 0.9);
    const b = span(5, 10, "IL_PHONE", 1);
    expect(resolveOverlaps([b, a])).toEqual([a, b]);
  });

  it("within the same priority, keeps the higher score", () => {
    const weak = span(0, 6, "LOCATION", 0.6);
    const strong = span(2, 9, "ORGANIZATION", 0.95);
    expect(resolveOverlaps([weak, strong])).toEqual([strong]);
  });

  it("within the same priority and score, keeps the longer span", () => {
    const short = span(0, 4, "ORGANIZATION", 0.9);
    const long = span(0, 8, "LOCATION", 0.9);
    expect(resolveOverlaps([short, long])).toEqual([long]);
  });

  it("returns a non-overlapping set sorted by start", () => {
    const out = resolveOverlaps([
      span(30, 40, "IL_PHONE"),
      span(0, 9, "ISRAELI_ID"),
      span(10, 20, "EMAIL_ADDRESS"),
    ]);
    expect(out.map((s) => s.start)).toEqual([0, 10, 30]);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].end);
    }
  });

  it("collapses two equal-strength overlapping spans to exactly one (deterministically)", () => {
    // ID and company both priority 3, score 1, same range — resolver keeps exactly one.
    const id = span(0, 9, "ISRAELI_ID", 1);
    const company = span(0, 9, "IL_COMPANY", 1);
    const out = resolveOverlaps([id, company]);
    expect(out).toHaveLength(1);
    // Deterministic tiebreak by type name: IL_COMPANY < ISRAELI_ID.
    expect(out[0].type).toBe("IL_COMPANY");
  });

  it("does not mutate the input array", () => {
    const input = [span(5, 10, "IL_PHONE"), span(0, 4, "PERSON")];
    const copy = [...input];
    resolveOverlaps(input);
    expect(input).toEqual(copy);
  });
});
