/**
 * Manual redaction terms — words/numbers the user adds by hand because the automatic detectors missed
 * them. Each term is matched as an exact substring; every occurrence becomes a MANUAL span (highest
 * priority, so an explicit human choice always wins overlap resolution). Framework-free and pure.
 */
import type { Span } from "./types";

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
    for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + term.length)) {
      spans.push({ start: at, end: at + term.length, type: "MANUAL", score: 1, ...(label ? { label } : {}) });
    }
  }
  return spans;
}
