/**
 * Overlap resolution — port of the server's analyze.py "keep strongest, drop overlaps" step.
 * Detection sources (deterministic recognizers + the NER wrapper) each emit spans independently,
 * so the same characters can be claimed twice. This greedily keeps the strongest span and drops
 * anything overlapping it, then returns a non-overlapping set in reading order.
 *
 * Strength order (strongest first): PRIORITY (deterministic 3 > PERSON 2 > ORG/LOCATION 1) →
 * score → length → earliest start → type name. The last two tiebreakers make the result
 * deterministic regardless of the order sources were concatenated in.
 */
import type { Span } from "./types";
import { PRIORITY } from "./types";

/** Negative when `a` is stronger than `b` (so it sorts earlier / wins an overlap). */
function byStrength(a: Span, b: Span): number {
  if (PRIORITY[a.type] !== PRIORITY[b.type]) {
    return PRIORITY[b.type] - PRIORITY[a.type];
  }
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  const lengthA = a.end - a.start;
  const lengthB = b.end - b.start;
  if (lengthA !== lengthB) {
    return lengthB - lengthA;
  }
  if (a.start !== b.start) {
    return a.start - b.start;
  }
  // A checksum-validated ISRAELI_ID beats a format-only IL_PHONE on the SAME span (a 9-digit ID that is
  // also landline-shaped). The Luhn checksum is stronger evidence than a numbering-plan coincidence, so
  // the value is labeled [ID_N] not [PHONE_N]. Pairwise + targeted — does not touch the PRIORITY map or
  // any other type pair (e.g. the ID vs IL_COMPANY tiebreak stays lexicographic).
  if (a.type === "ISRAELI_ID" && b.type === "IL_PHONE") return -1;
  if (a.type === "IL_PHONE" && b.type === "ISRAELI_ID") return 1;
  return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
}

/** Half-open intervals overlap when each starts before the other ends. */
function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Resolve overlaps into a non-overlapping span set in reading order (by start, then end).
 * Pure: does not mutate the input.
 */
export function resolveOverlaps(spans: readonly Span[]): readonly Span[] {
  const byStrongest = [...spans].sort(byStrength);
  const kept: Span[] = [];
  for (const span of byStrongest) {
    if (!kept.some((keeper) => overlaps(keeper, span))) {
      kept.push(span);
    }
  }
  return kept.sort((a, b) => a.start - b.start || a.end - b.end);
}

const WHITESPACE = /\s/;
/** Trim leading/trailing whitespace off an interval so a preserved remainder starts/ends on real text. */
function trimWhitespace(text: string, start: number, end: number): [number, number] {
  while (start < end && WHITESPACE.test(text[start])) start += 1;
  while (end > start && WHITESPACE.test(text[end - 1])) end -= 1;
  return [start, end];
}

/**
 * Like resolveOverlaps (keep the strongest span, drop overlaps), but a DROPPED span's non-overlapping
 * remainder is preserved as a span of its own type — so a shorter higher-priority span (e.g. a manual
 * term "יוסי") that overlaps a longer NER name ("יוסי כהן") no longer erases the name's other words
 * ("כהן" would otherwise leak). H-manual. Remainders are trimmed of surrounding whitespace and empties
 * dropped; the winners are exactly resolveOverlaps' winners, so this only ADDS coverage, never removes it.
 */
export function resolveOverlapsPreservingRemainders(
  text: string,
  spans: readonly Span[],
): readonly Span[] {
  const kept = resolveOverlaps(spans);
  const keptSet = new Set(kept);
  const remainders: Span[] = [];
  for (const span of spans) {
    if (keptSet.has(span)) {
      continue; // a winner, not dropped
    }
    // Subtract every kept interval from [span.start, span.end); what's left is the non-overlapping part.
    let segments: Array<[number, number]> = [[span.start, span.end]];
    for (const keeper of kept) {
      const next: Array<[number, number]> = [];
      for (const [a, b] of segments) {
        if (keeper.end <= a || keeper.start >= b) {
          next.push([a, b]); // no overlap with this keeper
          continue;
        }
        if (a < keeper.start) next.push([a, keeper.start]);
        if (b > keeper.end) next.push([keeper.end, b]);
      }
      segments = next;
    }
    for (const [a, b] of segments) {
      const [ts, te] = trimWhitespace(text, a, b);
      if (te > ts) {
        remainders.push({
          start: ts,
          end: te,
          type: span.type,
          score: span.score,
          ...(span.label ? { label: span.label } : {}),
        });
      }
    }
  }
  return remainders.length === 0 ? kept : resolveOverlaps([...kept, ...remainders]);
}
