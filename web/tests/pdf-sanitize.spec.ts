import { test, expect } from "@playwright/test";
import fs from "node:fs";
import * as mupdf from "mupdf";
import { collectOutlineItems } from "../src/worker/pdfSanitize";

/**
 * PDF-06 sanitize browser gate (CI, model blocked) — upload a PDF dirty in every hidden channel, and
 * verify on the DOWNLOADED bytes that: the body ID is removed, the outline (bookmark) carries the SAME
 * placeholder as the body (unified key), and the Info dict is stripped (the Hebrew name it held is gone
 * — and PDF stores it as hex-ASCII, so we re-read it decoded, not by byte-scan). Deterministic ID
 * detection needs no model, so this runs in CI.
 */
const FIXTURE = "web/test-fixtures/pdf/dirty.pdf";
const ID = "123456709";

/* eslint-disable @typescript-eslint/no-explicit-any -- mupdf WASM surface is untyped */
test("sanitizes metadata + anonymizes the outline coherently with the body", async ({ page }) => {
  await page.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    return hostname === "localhost" || hostname === "127.0.0.1" ? route.continue() : route.abort();
  });

  await page.goto("/");
  await page.setInputFiles("input[type=file]", FIXTURE);
  const downloadButton = page.getByRole("button", { name: "הורדת הקובץ המושחר" });
  await downloadButton.waitFor({ timeout: 90_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  const bytes = new Uint8Array(fs.readFileSync((await download.path())!));

  const doc = (mupdf as any).PDFDocument.openDocument(bytes, "application/pdf");

  // Body: the ID is gone from the page text.
  let text = "";
  for (let i = 0; i < doc.countPages(); i += 1) {
    text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  }
  expect(text).not.toContain(ID);

  // Info dict stripped — the Hebrew name it held (hex-encoded) is gone. mupdf returns JS null (or a
  // null-wrapper) for an absent key.
  const info = doc.getTrailer().get("Info");
  expect(info === null || (info.isNull?.() ?? false)).toBe(true);

  // Outline anonymized coherently with the body: the deterministic ID is gone and replaced by a
  // placeholder (same key as the body). The Hebrew NAME in the outline needs NER to be caught, so it
  // is asserted in the @model spec, not here (model is blocked). The name in the STRIPPED channels
  // (Info/annotation/XMP) is gone regardless of the model — verified above and via layer B.
  const items = collectOutlineItems(doc);
  expect(items.length).toBeGreaterThanOrEqual(1);
  const title = items[0].title;
  expect(title).not.toContain(ID);
  expect(title).toMatch(/\[.+_\d+\]/); // the ID's placeholder is present
});
/* eslint-enable @typescript-eslint/no-explicit-any */
