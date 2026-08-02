/**
 * Israeli teudat zehut (ID) recognizer — REAL checksum validation, no NER, no mocks.
 * Faithful port of the server's src/recognizers/israeli_id.py (pii-anonymizer-spike).
 *
 * The Israeli ID is 9 digits. Validity is a Luhn-style check digit: weight each digit
 * (left to right) by 1,2,1,2,...; if a product exceeds 9, subtract 9; the total must be
 * divisible by 10. Detection is regex + checksum ONLY (CLAUDE.md hard rule 1).
 */
import type { Recognizer, Span } from "../types";

const ALL_ZEROS = "000000000";
const ID_LENGTH = 9;

/** True if `raw` (any string) holds a checksum-valid Israeli ID. */
export function isValidIsraeliId(raw: string): boolean {
  const digitsOnly = raw.replace(/\D/g, "");
  if (digitsOnly.length === 0 || digitsOnly.length > ID_LENGTH) {
    return false;
  }
  // IDs shorter than 9 digits are left-padded with zeros (matches the server port).
  const digits = digitsOnly.padStart(ID_LENGTH, "0");
  if (digits === ALL_ZEROS) {
    return false; // passes the checksum but is never a real ID
  }
  let total = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let value = Number(digits[index]) * (index % 2 === 0 ? 1 : 2);
    if (value > 9) {
      value -= 9;
    }
    total += value;
  }
  return total % 10 === 0;
}

/**
 * Standalone 9-digit runs, like the server's `\b\d{9}\b` pattern.
 * (?<!\d) / (?!\d) forbid being part of a longer digit run without consuming characters,
 * so IL_IBAN / longer account numbers are not partially flagged as IDs.
 */
const NINE_DIGIT_RUN = /(?<!\d)\d{9}(?!\d)/g;

/** Flags 9-digit numbers that pass the Israeli ID checksum. */
export const israeliIdRecognizer: Recognizer = {
  name: "IsraeliIdRecognizer",
  entity: "ISRAELI_ID",
  recognize(text: string): readonly Span[] {
    const spans: Span[] = [];
    for (const match of text.matchAll(NINE_DIGIT_RUN)) {
      if (isValidIsraeliId(match[0])) {
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          type: "ISRAELI_ID",
          // Checksum-validated — the server boosts validated pattern hits to max score.
          score: 1,
        });
      }
    }
    return spans;
  },
};
