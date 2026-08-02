// Tokenizer RegExp shim — ported from browser-poc/index.html (Phase 0).
//
// DICTA's dictabert pretokenizer regex contains \" and \' (Hebrew gershayim/geresh
// in abbreviations like ח"פ, ת"ז). transformers.js compiles the pretokenizer with
// the `u` (unicode) flag, under which \" and \' are "Invalid escape" -> V8 rejects
// the RegExp and NER never runs. Non-special ASCII escapes are illegal only under
// /u; stripping the backslash is semantically identical (the char matches itself).
// We touch ONLY u/v-flagged patterns and ONLY the offending escapes, so no other
// regex behavior changes.
//
// This is a classic script loaded BEFORE the popup.js module, so the patched
// global RegExp is in place before transformers.js builds the tokenizer.
(function () {
  'use strict';
  const OrigRegExp = RegExp;
  // Backslash before an ASCII char that is NOT a valid RegExp escape and NOT a
  // regex metacharacter -> illegal under /u. Strip the backslash.
  const VALID_ESCAPE = /[dDwWsSbBnrtfv0xucpPkq\\/.*+?()[\]{}|^$]/;
  function sanitize(pattern) {
    return String(pattern).replace(/\\([\x00-\x7F])/g, (m, ch) =>
      VALID_ESCAPE.test(ch) ? m : ch
    );
  }
  function Patched(pattern, flags) {
    if (typeof pattern === 'string' && typeof flags === 'string' && /[uv]/.test(flags)) {
      try { return new OrigRegExp(pattern, flags); }
      catch (e) {
        if (e instanceof SyntaxError) return new OrigRegExp(sanitize(pattern), flags);
        throw e;
      }
    }
    return new OrigRegExp(pattern, flags);
  }
  Patched.prototype = OrigRegExp.prototype;
  Object.getOwnPropertyNames(OrigRegExp).forEach(function (k) {
    try { if (!(k in Patched)) Patched[k] = OrigRegExp[k]; } catch (e) { /* ignore */ }
  });
  // eslint-disable-next-line no-global-assign
  RegExp = Patched;
})();
