/**
 * Manual redaction terms — words/numbers the user adds by hand (typed or clicked in the preview) because
 * the automatic detectors missed them. Each term is matched as a discrete UNIT — the same letter/number
 * split the clickable preview uses — so clicking "47" redacts a standalone house number but NOT the "47"
 * inside "1947" or inside an ID's digit run, and clicking "דן" does not hit "ירדן". Every unit
 * occurrence becomes a MANUAL span (highest priority, so an explicit human choice always wins overlap
 * resolution). Framework-free and pure.
 */
import type { Span } from "./types";

const DIGIT = /\d/;
const LETTER = /[A-Za-z֐-׿]/;

/**
 * Does `[start,end)` sit on UNIT boundaries — not glued to a char of the SAME class (digit↔digit or
 * letter↔letter)? Letters and digits are separate classes (mirroring the preview's WORD_RUN split), so a
 * number is a unit next to a letter ("הרצל47") but not inside a longer number ("1947"), and a Hebrew
 * word is a unit next to a digit but not inside a longer word.
 */
function isUnit(text: string, start: number, end: number): boolean {
  const first = text[start];
  const last = text[end - 1];
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  const glued = (neighbor: string, edge: string): boolean =>
    (DIGIT.test(edge) && DIGIT.test(neighbor)) || (LETTER.test(edge) && LETTER.test(neighbor));
  return !glued(before, first) && !glued(after, last);
}

/** A manual term, optionally with a custom placeholder label (ASCII/Latin, e.g. "CLIENT" -> [CLIENT_1]).
 *  A plain string is shorthand for `{ value }` (default label -> [TERM_n]). */
export interface ManualTerm {
  readonly value: string;
  readonly label?: string;
}

/** A caller may pass a bare term string or a `{ value, label }` object. */
export type ManualInput = string | ManualTerm;

function toTerm(input: ManualInput): ManualTerm {
  return typeof input === "string" ? { value: input } : input;
}

/** Every occurrence of each (trimmed, non-empty) term in `text`, as MANUAL spans. A term's optional
 *  custom label rides on the span so anonymize can emit `[LABEL_n]` instead of the default `[TERM_n]`. */
export function manualSpans(text: string, terms: readonly ManualInput[]): Span[] {
  const spans: Span[] = [];
  for (const input of terms) {
    const { value, label } = toTerm(input);
    const term = value.trim();
    if (term.length === 0) {
      continue;
    }
    for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + 1)) {
      const end = at + term.length;
      if (isUnit(text, at, end)) {
        spans.push({ start: at, end, type: "MANUAL", score: 1, ...(label ? { label } : {}) });
      }
    }
  }
  return spans;
}
