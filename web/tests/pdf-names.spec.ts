import { test, expect } from "@playwright/test";
import fs from "node:fs";
import * as mupdf from "mupdf";
import { normalizeForLeak } from "../../engine/src/pdfVerify";

/**
 * PDF NER-name redaction gate — @model, run locally / before deploy (downloads the 185 MB model, so it
 * is excluded from CI). Loads NER, uploads a real Hebrew PDF, and asserts the Hebrew NAME is truly
 * removed from the downloaded file (layer A), while the only off-origin requests are the allowed model
 * hosts and none carry the uploaded file off-device.
 */
const FIXTURE = "web/test-fixtures/pdf/chromium-hebrew.pdf";
const NAME = "ישראל ישראלי";
const ALLOWED = ["huggingface.co", "hf.co", "jsdelivr.net"];

test("@model redacts the Hebrew name in a PDF and never uploads the file", async ({ page }) => {
  const offOrigin: { host: string; method: string }[] = [];
  page.on("request", (req) => {
    const { hostname } = new URL(req.url());
    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      offOrigin.push({ host: hostname, method: req.method() });
    }
  });

  await page.goto("/");
  await page.setInputFiles("input[type=file]", FIXTURE);

  // Wait for the model to load and the result to upgrade so the name chip appears.
  await expect(page.locator("mark", { hasText: "שם" })).toBeVisible({ timeout: 180_000 });

  const downloadButton = page.getByRole("button", { name: "הורדת הקובץ המושחר" });
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  const bytes = new Uint8Array(fs.readFileSync((await download.path())!));

  // Layer A: the Hebrew name is gone from the downloaded PDF's readable text.
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i += 1) {
    text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  }
  expect(normalizeForLeak(text).includes(normalizeForLeak(NAME))).toBe(false);

  // Every off-origin request is an allowed model-host GET — nothing else, no upload of the file.
  for (const req of offOrigin) {
    expect(ALLOWED.some((h) => req.host === h || req.host.endsWith(h))).toBe(true);
    expect(req.method).toBe("GET");
  }
});
