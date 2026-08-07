/**
 * Restore — put original values back into an anonymized text using the key. This is the second
 * half of the "anonymize before the AI" round-trip: the AI's answer comes back with placeholders,
 * and we swap the real values in, entirely in the browser (restore IS in the MVP — docs/tasks.md).
 *
 * TOLERANT MATCHER: an LLM or an RTL editor can mangle the placeholder TOKEN (not the value) — it
 * may smart-quote the gershayim (`[ID_1]` -> `[ID_1]`), inject invisible bidi controls, or add
 * spaces. We normalise both the key placeholders and the tokens found in the text before matching,
 * so those cosmetic changes don't break restore. Unmatched placeholders are reported, never
 * silently dropped.
 */
import type { KeyRow } from "./types";

/** Invisible bidi controls LLMs/RTL editors inject: LRM/RLM (200E/F), LRE..RLO (202A-202E),
 *  and the directional isolates FSI/LRI/RLI/PDI (2066-2069). */
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;
/** Any quote/apostrophe variant, incl. Hebrew gershayim (U+05F4) and geresh (U+05F3). */
const QUOTE_VARIANTS = /["'`״׳“”‟‘’]/g;

/** A placeholder-shaped token: `[ ... _<digits> ]`, tolerating internal spaces. */
const PLACEHOLDER_TOKEN = /\[[^[\]]*_\d+\s*\]/g;

/** Count placeholder-shaped tokens in `text`, using the SAME tolerant pattern `restore` matches on, so
 *  callers (e.g. the "restored N values" count / the returned-from-AI heuristic) never under-count
 *  relative to what actually restores. */
export function countPlaceholderTokens(text: string): number {
  return text.match(PLACEHOLDER_TOKEN)?.length ?? 0;
}

/** Canonical form of a placeholder for matching: NFC, no bidi controls, no quotes, no spaces. */
export function normalizePlaceholder(token: string): string {
  return token
    .normalize("NFC")
    .replace(BIDI_CONTROLS, "")
    .replace(QUOTE_VARIANTS, "")
    .replace(/\s+/g, "");
}

/** The set of normalized placeholder tokens already present in `text`, using the SAME tolerant pattern
 *  restore matches on. anonymize uses this so a minted `[LABEL_n]` never collides (even tolerantly) with a
 *  pre-existing token — otherwise restore would inject a value into prose that never held it (M-4). */
export function normalizedPlaceholdersIn(text: string): ReadonlySet<string> {
  const set = new Set<string>();
  for (const token of text.match(PLACEHOLDER_TOKEN) ?? []) {
    set.add(normalizePlaceholder(token));
  }
  return set;
}

/** Result of a restore: the rebuilt text and any placeholder tokens we could not map. */
export interface RestoreResult {
  readonly restoredText: string;
  /** Placeholder-shaped tokens found in the text with no matching key row (surface forms). */
  readonly unmatched: readonly string[];
}

/**
 * Replace placeholder tokens in `text` with their original values from `key`. Tolerant to
 * cosmetic token mangling; reports unmatched tokens. Pure. Inserted originals are not re-scanned
 * (String.replace works over the original text), so a value that itself looks like a placeholder
 * is never double-restored.
 */
export function restore(text: string, key: readonly KeyRow[]): RestoreResult {
  const byNormalized = new Map<string, string>();
  for (const row of key) {
    byNormalized.set(normalizePlaceholder(row.placeholder), row.original);
  }

  const unmatched: string[] = [];
  const restoredText = text.replace(PLACEHOLDER_TOKEN, (token) => {
    const original = byNormalized.get(normalizePlaceholder(token));
    if (original === undefined) {
      unmatched.push(token);
      return token;
    }
    return original;
  });

  return { restoredText, unmatched };
}
