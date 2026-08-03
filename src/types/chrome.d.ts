/**
 * The sliver of the extension API this shell actually uses.
 *
 * Declared locally instead of pulling in @types/chrome: one method does not justify a
 * dependency (CLAUDE.md — "do not add a dependency without a reason"). Widen this as the
 * popup grows to need more of the API.
 *
 * `engine/` must never reference this — chrome.* belongs to the shell (hard rule 4).
 */
declare const chrome: {
  runtime: {
    /** Absolute chrome-extension:// URL for a path packaged inside the extension. */
    getURL(path: string): string;
  };
};
