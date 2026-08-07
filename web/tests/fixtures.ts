import { test as base, expect } from "@playwright/test";

/**
 * Shared e2e fixture. Manual-only detection is now the app DEFAULT (the 185MB model is an explicit
 * opt-in, not a forced first-load download). The e2e suite must exercise the deterministic + model
 * detection paths, so seed the "automatic" preference in localStorage before every page load. This
 * makes behavior identical to before the default flipped: a plain submit runs automatic detection and
 * loadNer exactly as it did.
 */
export const test = base.extend({
  // `runTest` is Playwright's fixture "use" callback (renamed so eslint's react-hooks rule does not
  // mistake it for a React hook). It hands the prepared page to the test.
  page: async ({ page }, runTest) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("mechikon.manualOnly", "0");
      } catch {
        // Private mode / storage disabled — harmless; the app just falls back to its default.
      }
    });
    await runTest(page);
  },
});

export { expect };
