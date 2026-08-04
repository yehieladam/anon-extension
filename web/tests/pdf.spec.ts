import { test, expect } from "@playwright/test";
import fs from "node:fs";
import * as mupdf from "mupdf";
import { layerB, layerC, normalizeForLeak } from "../../engine/src/pdfVerify";

/**
 * PDF acceptance gate (P0I-06), CORE — CI, no model. We block the NER model/runtime hosts so
 * anonymizeSmart falls back to deterministic detection; then uploading a real Hebrew PDF must:
 *  1. make ZERO requests to anything but the (blocked) allowed model hosts — proving the PDF path
 *     itself sends nothing off-device, and that the whole flow works fully offline;
 *  2. produce a downloadable redacted PDF whose ID + phone are truly removed (three layers), verified
 *     on the exact bytes that left the app. mupdf redaction runs in the browser worker here.
 *
 * NER-name redaction in a PDF shares this pipeline and is covered by pdf-names.spec.ts (@model).
 */
const FIXTURE = "web/test-fixtures/pdf/chromium-hebrew.pdf";
const NEEDLES = ["123456709", "052-1234567"];
const ALLOWED_MODEL_HOSTS = ["huggingface.co", "hf.co", "jsdelivr.net"];

function isAllowedModelHost(hostname: string): boolean {
  return ALLOWED_MODEL_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`) || hostname.endsWith(h));
}

test("PDF path is offline + redacts ID/phone truly (model blocked)", async ({ page }) => {
  const offHostRequests: string[] = [];
  await page.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return route.continue();
    }
    offHostRequests.push(hostname);
    return route.abort(); // block every off-origin request (model hosts included)
  });

  await page.goto("/");
  await page.setInputFiles("input[type=file]", FIXTURE);

  const downloadButton = page.getByRole("button", { name: "הורדת הקובץ המושחר" });
  await downloadButton.waitFor({ timeout: 90_000 }); // cold mupdf WASM compile on first use

  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  const bytes = new Uint8Array(fs.readFileSync((await download.path())!));

  // Zero-network on the PDF path: the ONLY off-host requests attempted are the allowed model hosts
  // (which we blocked) — nothing else, and nothing carried the file. Redaction worked with them down.
  const unexpected = [...new Set(offHostRequests)].filter((h) => !isAllowedModelHost(h));
  expect(unexpected).toEqual([]);

  // Three layers on the downloaded bytes. Layer A (re-extract) is the meaningful check for a CID font
  // where the PII is stored as glyph IDs — layer B is blind to that, so A proves true removal.
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i += 1) {
    text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  }
  const norm = normalizeForLeak(text);
  for (const needle of NEEDLES) {
    expect(norm.includes(normalizeForLeak(needle))).toBe(false); // layer A
  }
  expect((await layerB(bytes, NEEDLES)).pass).toBe(true); // layer B
  expect(layerC(bytes).pass).toBe(true); // layer C
});
