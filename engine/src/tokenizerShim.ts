/**
 * Tokenizer RegExp shim — ported from the Phase-0 spike (browser-poc/index.html, then
 * extension/shim.js). Framework-free: patches a JS builtin only, no DOM, no chrome.*.
 *
 * DICTA's dictabert pretokenizer regex contains `\"` and `\'` (Hebrew gershayim/geresh in
 * abbreviations like ח"פ, ת"ז). transformers.js compiles the pretokenizer with the `u`
 * (unicode) flag, under which those are "Invalid escape" -> V8 rejects the RegExp and NER
 * NEVER RUNS. Non-special ASCII escapes are illegal only under /u; stripping the backslash
 * is semantically identical (the character matches itself). Only u/v-flagged patterns and
 * only the offending escapes are touched, so no other regex behaviour changes.
 *
 * Call `installTokenizerShim()` before creating a transformers.js pipeline. It is an
 * explicit function rather than an import side effect so the patch stays greppable, and
 * so the future web app opts in the same way the extension does.
 *
 * This becomes unnecessary once P4-02 self-hosts a pre-patched tokenizer.json.
 */

/** Backslash + ASCII char that is a genuine RegExp escape or metacharacter — leave alone. */
const VALID_ESCAPE = /[dDwWsSbBnrtfv0xucpPkq\\/.*+?()[\]{}|^$]/;

let installed = false;

/** Strip backslashes that are illegal under /u from an otherwise valid pattern. */
function sanitize(pattern: string): string {
  // eslint-disable-next-line no-control-regex -- matching the full ASCII range is the point
  return pattern.replace(/\\([\x00-\x7F])/g, (match, escaped: string) =>
    VALID_ESCAPE.test(escaped) ? match : escaped,
  );
}

/**
 * Replace the global RegExp constructor with one that retries a failed u/v-flagged
 * pattern after sanitizing it. Idempotent; safe to call more than once.
 */
export function installTokenizerShim(): void {
  if (installed) return;
  const OriginalRegExp = RegExp;

  function PatchedRegExp(pattern: string | RegExp, flags?: string): RegExp {
    if (typeof pattern === "string" && typeof flags === "string" && /[uv]/.test(flags)) {
      try {
        return new OriginalRegExp(pattern, flags);
      } catch (error) {
        // Only a compile failure is worth retrying — rethrow anything else untouched.
        if (error instanceof SyntaxError) return new OriginalRegExp(sanitize(pattern), flags);
        throw error;
      }
    }
    return new OriginalRegExp(pattern, flags);
  }

  PatchedRegExp.prototype = OriginalRegExp.prototype;
  // Inherit the statics (including live accessors like RegExp.$1 and Symbol.species)
  // rather than snapshotting them, which a copy loop would do.
  Object.setPrototypeOf(PatchedRegExp, OriginalRegExp);

  // reason: replacing a JS builtin is inherently untypeable; the shape is verified by
  // tokenizerShim.test.ts and by the S-01 run that proved the unpatched path throws.
  globalThis.RegExp = PatchedRegExp as unknown as RegExpConstructor;
  installed = true;
}

/** Whether the shim is active in this realm. Exposed for tests and diagnostics. */
export function isTokenizerShimInstalled(): boolean {
  return installed;
}
