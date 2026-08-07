/**
 * Detection pipeline — orchestrates the deterministic recognizers into a single anonymize call.
 * Framework-free, so the Web Worker (web) and the extension both reuse it unchanged. NER is added
 * separately (it is async + needs the model): `anonymizeFull` merges NER spans when available.
 */
import type { AnonymizeResult, Recognizer, Span } from "./types";
import { resolveOverlaps } from "./resolve";
import { completeOccurrences } from "./occurrences";
import { anonymize } from "./anonymize";
import { normalizeForDetection, mapShadowSpan } from "./normalize";
import { manualSpans, type ManualInput } from "./manual";
import { israeliIdRecognizer } from "./recognizers/israeliId";
import { israeliPhoneRecognizer } from "./recognizers/israeliPhone";
import { israeliCompanyRecognizer } from "./recognizers/israeliCompany";
import { israeliIbanRecognizer } from "./recognizers/israeliIban";
import { israeliCaseRecognizer } from "./recognizers/israeliCase";
import { israeliLandRecognizer } from "./recognizers/israeliLand";
import { israeliPolicyRecognizer } from "./recognizers/israeliPolicy";
import { israeliInsuredRecognizer } from "./recognizers/israeliInsured";
import { emailRecognizer } from "./recognizers/email";

/** All deterministic (regex + checksum / context) recognizers — never the NER model (hard rule 1). */
export const DETERMINISTIC_RECOGNIZERS: readonly Recognizer[] = [
  israeliIdRecognizer,
  israeliCompanyRecognizer,
  israeliIbanRecognizer,
  israeliPhoneRecognizer,
  israeliCaseRecognizer,
  israeliLandRecognizer,
  israeliPolicyRecognizer,
  israeliInsuredRecognizer,
  emailRecognizer,
];

/**
 * Run every deterministic recognizer and return the raw (possibly overlapping) spans.
 *
 * Recognizers run on a NORMALIZED shadow (invisible bidi/format marks stripped, digit variants folded)
 * so a value split by an embedded RLM / written in fullwidth digits is still found (B1 + L2); spans map
 * back to EXACT original offsets, so the original text (and its tokenized positions) is never mutated.
 * When nothing normalizes (the common case), the shadow equals the text and we skip the mapping.
 */
export function detectDeterministic(text: string): Span[] {
  const { shadow, map } = normalizeForDetection(text);
  const rawSpans = DETERMINISTIC_RECOGNIZERS.flatMap((recognizer) => recognizer.recognize(shadow));
  if (shadow === text) {
    return rawSpans;
  }
  return rawSpans.map((span) => {
    const { start, end } = mapShadowSpan(map, span.start, span.end, text.length);
    return { ...span, start, end };
  });
}

/** Deterministic-only anonymize: detect → resolve overlaps → anonymize. Instant (no model). */
export function anonymizeDeterministic(text: string): AnonymizeResult {
  const resolved = resolveOverlaps(detectDeterministic(text));
  return anonymize(text, resolved);
}

/**
 * Full anonymize: deterministic spans + already-computed NER spans, resolved together (deterministic
 * outranks NER via PRIORITY) then anonymized. Callers run NER (async) and pass its spans in.
 */
export function anonymizeFull(text: string, nerSpans: readonly Span[]): AnonymizeResult {
  return anonymizeWith(text, nerSpans);
}

/**
 * Deterministic detection PLUS any caller-supplied spans (NER, and/or manual user terms), resolved
 * together and anonymized. Manual spans (PRIORITY 4) win overlaps; deterministic outranks NER.
 *
 * `excluded` holds surface values the user chose to REVEAL (un-redact a false-positive auto detection,
 * e.g. a bank name mis-tagged as a location). Any AUTOMATIC span whose exact value is excluded is
 * dropped before + after occurrence-completion, so it never re-appears. A MANUAL term is never excluded
 * (an explicit human choice always wins).
 */
export function anonymizeWith(
  text: string,
  extraSpans: readonly Span[],
  excluded: readonly string[] = [],
): AnonymizeResult {
  const excludedSet = new Set(excluded);
  const isExcluded = (span: Span): boolean =>
    span.type !== "MANUAL" && excludedSet.has(text.slice(span.start, span.end));
  const base = resolveOverlaps(
    [...detectDeterministic(text), ...extraSpans].filter((span) => !isExcluded(span)),
  );
  // Redact every whole-word occurrence of each confirmed value, not only the tagged ones — otherwise a
  // name NER caught in one place but missed in another (or tagged only half of) leaks the rest.
  const completed = completeOccurrences(text, base).filter((span) => !isExcluded(span));
  const resolved = resolveOverlaps([...base, ...completed]);
  return anonymize(text, resolved);
}

/**
 * MANUAL-ONLY anonymize: redact ONLY the user's chosen terms — NO automatic detection (no
 * deterministic recognizers, no NER). For users who want full control and zero over-redaction, and it
 * needs no model, so it is instant. `manualSpans` already covers every occurrence of each term, so no
 * occurrence-completion pass is needed.
 */
export function anonymizeManualOnly(
  text: string,
  terms: readonly ManualInput[],
): AnonymizeResult {
  return anonymize(text, resolveOverlaps(manualSpans(text, terms)));
}
