import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import * as XLSX from "xlsx";

/**
 * Browser smoke for the non-PDF flows, under production headers.
 *
 * The restore round-trip is model-free (deterministic PII only) so it runs in CI. The Office (docx /
 * xlsx) redaction tests are @model: uploading a file loads NER and the app deliberately withholds the
 * download until NER has settled, so nobody saves a half-redacted document — that gate means the file
 * download path can only be exercised with the model present.
 */

const PHONE = "052-1234567";
const ID = "123456709";

/** Minimal but valid .docx (a zip with the two parts Word needs) carrying deterministic PII. */
async function buildDocx(): Promise<Buffer> {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t xml:space="preserve">לקוח בטלפון ${PHONE} ותעודת זהות ${ID}</w:t></w:r></w:p></w:body>
</w:document>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", document);
  return zip.generateAsync({ type: "nodebuffer" });
}

/** Minimal .xlsx with a cell holding deterministic PII. */
function buildXlsx(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([["לקוח", `טלפון ${PHONE}`]]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  // bookSST: shared strings, like real Excel/Sheets output — the format the overlay redaction targets
  // (inline sheet strings are a documented not-yet-handled case in officeRedact).
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", bookSST: true }) as Buffer;
}

/** Upload a file to the MAIN upload input, wait for NER to settle, and capture the redacted download. */
async function uploadAndDownload(
  page: import("@playwright/test").Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<Uint8Array> {
  await page.setInputFiles("input[type=file] >> nth=0", file);
  // The download button only appears once NER has settled (the app blocks a half-redacted download).
  const downloadButton = page.getByRole("button", { name: "הורדת הקובץ המושחר" });
  await expect(downloadButton).toBeVisible({ timeout: 260_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  const fs = await import("node:fs");
  return new Uint8Array(fs.readFileSync((await download.path())!));
}

test("restore: paste → redact (in-memory key) → restore brings the originals back", async ({
  page,
}) => {
  await page.goto("/");
  await page.fill("textarea", `לקוח בטלפון ${PHONE} ותעודת זהות ${ID}`);
  await page.getByRole("button", { name: "השחרת המסמך" }).click();
  await expect(page.locator("mark", { hasText: "טלפון" })).toBeVisible({ timeout: 15_000 });

  // Open the restore panel (its textarea is pre-filled with the anonymized text; the in-memory key from
  // the redaction above is active) and restore. The originals appear only in the restored-text panel.
  await page.getByText("שחזור הערכים המקוריים").click();
  await page.getByRole("button", { name: "שחזור", exact: true }).click();
  await expect(page.getByText(PHONE, { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(ID, { exact: false })).toBeVisible();
});

test("@model docx + xlsx: redact in place and download a file without the originals", async ({
  page,
}) => {
  await page.goto("/");

  const docxBytes = await uploadAndDownload(page, {
    name: "doc.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await buildDocx(),
  });
  const docXml = await (await JSZip.loadAsync(docxBytes)).file("word/document.xml")!.async("string");
  expect(docXml).toContain("[PHONE_1]");
  expect(docXml).toContain("[ID_1]");
  expect(docXml).not.toContain(PHONE);
  expect(docXml).not.toContain(ID);

  // NER is cached now, so the second upload's download is immediate.
  const xlsxBytes = await uploadAndDownload(page, {
    name: "book.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buildXlsx(),
  });
  const sharedStrings = await (await JSZip.loadAsync(xlsxBytes))
    .file("xl/sharedStrings.xml")!
    .async("string");
  expect(sharedStrings).toContain("[PHONE_1]");
  expect(sharedStrings).not.toContain(PHONE);
});
