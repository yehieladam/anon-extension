/**
 * Manual redaction terms — words/numbers the user adds by hand because the automatic detectors missed
 * them. Each term is matched as an exact substring; every occurrence becomes a MANUAL span (highest
 * priority, so an explicit human choice always wins overlap resolution). Framework-free and pure.
 */
import type { Span } from "./types";

/** Every occurrence of each (trimmed, non-empty) term in `text`, as MANUAL spans. */
export function manualSpans(text: string, terms: readonly string[]): Span[] {
  const spans: Span[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (term.length === 0) {
      continue;
    }
    for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + term.length)) {
      spans.push({ start: at, end: at + term.length, type: "MANUAL", score: 1 });
    }
  }
  return spans;
}
