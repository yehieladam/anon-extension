/**
 * Email address (EMAIL_ADDRESS) recognizer — deterministic structural pattern, no NER. Replaces
 * Presidio's built-in email recognizer on the client. Mirrors the server's EMAIL handling
 * (not vendored here — a pragmatic RFC-sane pattern, not the full RFC 5322 grammar).
 *
 * Matches `local@domain.tld` where the TLD is ≥2 letters, so Israeli `.co.il` (and any multi-label
 * domain) is covered. Plain Hebrew text has no `@`, so there are no false hits on prose.
 */
import type { Recognizer, Span } from "../types";

/**
 * local@domain.tld. Boundaries: `(?<![\w.%+-])` / `(?![\w-])` stop the match from gluing onto an
 * adjacent ASCII token. Hebrew letters are not `\w`, and prose has no `@`, so there are no false hits.
 */
const EMAIL =
  /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;

/** Flags well-formed email addresses. */
export const emailRecognizer: Recognizer = {
  name: "EmailRecognizer",
  entity: "EMAIL_ADDRESS",
  recognize(text: string): readonly Span[] {
    const spans: Span[] = [];
    for (const match of text.matchAll(EMAIL)) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "EMAIL_ADDRESS",
        score: 1,
      });
    }
    return spans;
  },
};
