/**
 * Insured-person number (IL_INSURED, מספר מבוטח) recognizer — context-anchored, no checksum.
 * Like the policy number, there is no national format, so the keyword מבוטח introducing a number
 * is the signal. The bare word מבוטח (the insured person) with no number is ignored. We flag the
 * number token only. Mirrors the server's IL_INSURED recognizer (src/recognizers/
 * israeli_insured.py; not vendored here — faithful re-implementation).
 */
import type { Recognizer, Span } from "../types";

/** מבוטח (מספר | מס׳)? <digits>. */
const INSURED_CONTEXT = /מבוטח(?:\s+(?:מספר|מס['׳]?))?\s+(\d{4,15})/g;

/** Flags numbers introduced by the keyword מבוטח. */
export const israeliInsuredRecognizer: Recognizer = {
  name: "IsraeliInsuredRecognizer",
  entity: "IL_INSURED",
  recognize(text: string): readonly Span[] {
    const spans: Span[] = [];
    for (const match of text.matchAll(INSURED_CONTEXT)) {
      const value = match[1];
      const start = match.index + match[0].indexOf(value);
      spans.push({
        start,
        end: start + value.length,
        type: "IL_INSURED",
        score: 0.9,
      });
    }
    return spans;
  },
};
