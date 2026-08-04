/**
 * Israeli company / non-profit number (ח״פ / מספר תאגיד) recognizer — deterministic,
 * regex + checksum, no NER (CLAUDE.md hard rule 1). Mirrors the server's IL_COMPANY
 * recognizer (src/recognizers/israeli_company.py; not vendored in this repo — faithful
 * re-implementation of the same rule).
 *
 * A registered company/amuta number is 9 digits that (a) begin with 5 (companies and
 * non-profits are allocated in the 5xxxxxxxx range) and (b) pass the same Luhn-style check
 * digit as the teudat zehut. Detection stays regex + checksum only.
 *
 * NOTE ON OVERLAP: a 5-leading 9-digit number can also satisfy the ISRAELI_ID checksum, so
 * both recognizers may fire on it. That is expected — resolve.ts (P1-12) dedups overlapping
 * spans by PRIORITY; ISRAELI_ID and IL_COMPANY share priority 3, so the resolver keeps one.
 */
import type { Recognizer, Span } from "../types";

const COMPANY_LENGTH = 9;

/** Luhn-style check identical to the teudat zehut (weights 1,2,1,2,…; digit-sum mod 10 === 0). */
function passesChecksum(digits: string): boolean {
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

/** True if `raw` is a checksum-valid Israeli company/non-profit number (9 digits, leading 5). */
export function isValidIsraeliCompany(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== COMPANY_LENGTH || digits[0] !== "5") {
    return false;
  }
  return passesChecksum(digits);
}

/** Standalone 9-digit runs (same boundary guard as the ID recognizer). */
const NINE_DIGIT_RUN = /(?<!\d)\d{9}(?!\d)/g;

/** Flags checksum-valid company/non-profit numbers (ח״פ). */
export const israeliCompanyRecognizer: Recognizer = {
  name: "IsraeliCompanyRecognizer",
  entity: "IL_COMPANY",
  recognize(text: string): readonly Span[] {
    const spans: Span[] = [];
    for (const match of text.matchAll(NINE_DIGIT_RUN)) {
      if (isValidIsraeliCompany(match[0])) {
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          type: "IL_COMPANY",
          score: 1,
        });
      }
    }
    return spans;
  },
};
