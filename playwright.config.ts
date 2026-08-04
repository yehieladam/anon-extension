import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright harness (P0I-06). The PDF redaction / OCR paths run real WASM and cannot be verified in
 * node-only Vitest — they must run in a real browser. Tests run against `vite preview` (NOT dev), so
 * the strict CSP + COOP/COEP headers are exactly the production ones: a test that passes here passes
 * in prod, and a CSP/COEP regression fails the build.
 */
export default defineConfig({
  testDir: "web/tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 240_000, // the model/wasm downloads can be slow on a cold cache
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build then preview on a fixed port so the harness has a stable URL with production headers.
    command: "npm run build:web && npm run preview:e2e",
    url: "http://localhost:4173",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
