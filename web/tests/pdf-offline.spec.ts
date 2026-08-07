import { test, expect } from "./fixtures";

/**
 * PDF offline gate (CI, model-free) — the two properties only a REAL browser proves. The redaction
 * mechanics (true removal across all three layers, metadata strip, outline coherence) are verified in
 * node in web/src/worker/pdfRedact.test.ts; here we prove:
 *
 *  1. ZERO-EXFIL (load-bearing): with every off-origin request blocked, uploading a PDF sends nothing
 *     off-device except attempts to the allowed model hosts — the network-isolation proof behind the
 *     whole client-side claim. Nothing carries the file.
 *  2. H3 BLOCK: with the names model unreachable (ner.status === "error"), the file download is
 *     WITHHELD — no download button, a retry + a clear notice — while the deterministic ID/phone chips
 *     still render. We never hand back a file whose names were not removed.
 */
const FIXTURE = "web/test-fixtures/pdf/chromium-hebrew.pdf";
const ALLOWED_MODEL_HOSTS = ["huggingface.co", "hf.co", "jsdelivr.net"];

function isAllowedModelHost(hostname: string): boolean {
  return ALLOWED_MODEL_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`) || hostname.endsWith(h));
}

test("PDF offline: nothing exfiltrates, and the download is blocked until names verify", async ({
  page,
}) => {
  const offHostRequests: string[] = [];
  await page.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return route.continue();
    }
    offHostRequests.push(hostname);
    return route.abort(); // block every off-origin request (model hosts included → NER fails)
  });

  await page.goto("/");
  await page.setInputFiles("input[type=file]", FIXTURE);

  // NER can't load (blocked) → H3 withholds the file. Wait for the block, not a download.
  const retry = page.getByRole("button", { name: "נסה שוב לזהות שמות" });
  await expect(retry).toBeVisible({ timeout: 90_000 });

  // No download button exists in the errored state; the block notice is shown.
  expect(await page.getByRole("button", { name: "הורדת הקובץ המושחר" }).count()).toBe(0);
  await expect(page.getByText("לא הפקנו קובץ")).toBeVisible();

  // Deterministic detection still worked — placeholder chips render; the file is withheld, not the
  // detection. Match any placeholder token ([…_N]) to stay robust to the exact entity label.
  await expect(page.locator("button").filter({ hasText: /_\d+\]/ }).first()).toBeVisible();

  // Zero-exfil: the ONLY off-host requests attempted are the allowed model hosts (all blocked).
  const unexpected = [...new Set(offHostRequests)].filter((h) => !isAllowedModelHost(h));
  expect(unexpected).toEqual([]);
});
