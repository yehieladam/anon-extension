/**
 * Israeli court case number (IL_CASE, מספר תיק) recognizer — pattern + context, no checksum
 * exists for these, so detection is deliberately CONSERVATIVE (favour precision over recall):
 * we only flag the distinctive "net hamishpat" dash format and numbers explicitly introduced by
 * the word תיק. Mirrors the server's IL_CASE recognizer (src/recognizers/israeli_case.py; not
 * vendored here — faithful re-implementation).
 *
 * RECONCILE: the case-type-prefixed forms (ת״א 1234/20, בג״ץ …) are intentionally NOT matched
 * yet — the exact prefix set + quoting live in the server file. Add them when it is available,
 * so we don't invent patterns that over-match plain Hebrew abbreviations.
 */
import type { Recognizer, Span } from "../types";

/**
 * "Net hamishpat" format NNNNN-MM-YY: a 5–7 digit case number, hyphen, 2-digit month, 2-digit
 * year. First group is ≥5 digits on purpose — that excludes 4-digit ISO dates (2020-06-15).
 */
const NET_HAMISHPAT = /(?<!\d)\d{5,7}-\d{2}-\d{2}(?!\d)/g;

/** A number introduced by תיק (optionally תיק מספר / תיק מס׳), e.g. "תיק 12345/20". */
const TIK_CONTEXT = /תיק(?:\s+(?:מספר|מס['׳]?))?\s+(\d{3,7}(?:\/\d{2,4})?)/g;

/** Flags Israeli court case numbers (conservative: dash format + תיק-introduced numbers). */
export const israeliCaseRecognizer: Recognizer = {
  name: "IsraeliCaseRecognizer",
  entity: "IL_CASE",
  recognize(text: string): readonly Span[] {
    const spans: Span[] = [];

    for (const match of text.matchAll(NET_HAMISHPAT)) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "IL_CASE",
        // No checksum; distinctive format but not certain — below deterministic-with-checksum.
        score: 0.9,
      });
    }

    for (const match of text.matchAll(TIK_CONTEXT)) {
      // Flag only the number itself (capture group 1), not the word תיק.
      const value = match[1];
      const start = match.index + match[0].indexOf(value);
      spans.push({
        start,
        end: start + value.length,
        type: "IL_CASE",
        score: 0.9,
      });
    }

    return spans;
  },
};
