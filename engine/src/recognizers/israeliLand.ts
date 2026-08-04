/**
 * Israeli land parcel (IL_LAND, גוש/חלקה) recognizer — keyword-anchored pattern, no checksum.
 * A parcel is identified by the words גוש (block) and חלקה (plot) each followed by a number,
 * optionally with a sub-plot (תת-חלקה) written as /N. Anchoring on both Hebrew keywords keeps
 * false positives low (bare numbers are meaningless; "גוש עציון" has no digit and is ignored).
 * Mirrors the server's IL_LAND recognizer (src/recognizers/israeli_land.py; not vendored here —
 * faithful re-implementation).
 */
import type { Recognizer, Span } from "../types";

/** גוש <num> … חלקה <num>[/sub] — tolerates ":", ",", and a hyphen/dash between the two parts. */
const GUSH_CHELKA =
  /גוש\s*:?\s*\d{1,6}\s*[,\-–]?\s*חלק(?:ה|ות)\s*:?\s*\d{1,5}(?:\s*\/\s*\d{1,4})?/g;

/** Flags גוש/חלקה parcel identifiers as a single span. */
export const israeliLandRecognizer: Recognizer = {
  name: "IsraeliLandRecognizer",
  entity: "IL_LAND",
  recognize(text: string): readonly Span[] {
    const spans: Span[] = [];
    for (const match of text.matchAll(GUSH_CHELKA)) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "IL_LAND",
        // Both keywords present — high confidence for a context-only (checksum-less) match.
        score: 1,
      });
    }
    return spans;
  },
};
