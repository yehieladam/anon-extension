/**
 * Scan routing (OCR Stage 5) — MODEL-FREE, CI-safe. Proves the dispatcher routes a scanned (image-only)
 * PDF to the OCR path ONLY when the flag is on, that the refusal codes propagate through redactFile, and
 * that classification is correct. Uses node mupdf (fine in CI) with an INJECTED fake OCR — no tesseract,
 * no 21 MiB assets, no network. The heavy real-OCR proof is scanRedact.node.test.ts (RUN_OCR-gated).
 */
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { anonymizeDeterministic } from "@engine/pipeline";
import type { OcrPageResult, OcrWord } from "@engine/ocrTypes";
import { redactFile } from "./officeRedact";
import { isScannedPdf } from "./pdfRedact";

/* eslint-disable @typescript-eslint/no-explicit-any -- mupdf node surface is untyped */
function abs(rel: string): string {
  return fileURLToPath(new URL(rel, import.meta.url));
}
const TEXT_PDF = "../../test-fixtures/pdf/chromium-hebrew.pdf";

/** Build a single-full-page-image (scanned) PDF from the text fixture — no OCR, mupdf only. */
async function buildScanPdf(): Promise<ArrayBuffer> {
  const mupdf: any = await import("mupdf");
  const src = mupdf.PDFDocument.openDocument(readFileSync(abs(TEXT_PDF)), "application/pdf");
  const pix = src.loadPage(0).toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceRGB, false);
  const doc = new mupdf.PDFDocument();
  const imgRef = doc.addImage(new mupdf.Image(pix));
  const resources = doc.addObject({ XObject: { Img: imgRef } });
  const wPt = (pix.getWidth() * 72) / 200;
  const hPt = (pix.getHeight() * 72) / 200;
  const page = doc.addPage([0, 0, wPt, hPt], 0, resources, `q ${wPt} 0 0 ${hPt} 0 0 cm /Img Do Q`);
  doc.insertPage(-1, page);
  return new Uint8Array(doc.saveToBuffer({ garbage: "deduplicate" }).asUint8Array()).buffer;
}

const word = (text: string, confidence: number): OcrWord => ({ text, confidence, bbox: { x0: 100, y0: 100, x1: 300, y1: 140 } });
const ocrOf =
  (page: OcrPageResult) =>
  async (): Promise<OcrPageResult> => page;
const cleanNoPii: OcrPageResult = { words: [word("שלום", 90), word("עולם", 90)], meanConfidence: 90, imageWidth: 1000, imageHeight: 1400 };
const lowConf: OcrPageResult = { words: [word("טשטוש", 40), word("רעש", 40)], meanConfidence: 40, imageWidth: 1000, imageHeight: 1400 };
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("scan routing (Stage 5, model-free)", () => {
  it("classifies an image-only PDF as scan and the text fixture as text", async () => {
    expect(await isScannedPdf(await buildScanPdf())).toBe(true);
    expect(await isScannedPdf(readFileSync(abs(TEXT_PDF)).buffer as ArrayBuffer)).toBe(false);
  });

  it("routes a scanned PDF to the OCR path when the flag is ON (returns bytes, no NO_TEXT_LAYER)", async () => {
    const scan = await buildScanPdf();
    const { bytes } = await redactFile("scan.pdf", scan, anonymizeDeterministic, {
      scanOcr: true,
      ocr: ocrOf(cleanNoPii), // no PII → nothing redacted → self-verify skipped → bytes returned
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes && bytes.length).toBeGreaterThan(0);
  });

  it("refuses a low-quality scan with SCAN_LOW_CONFIDENCE (code propagates through redactFile)", async () => {
    const scan = await buildScanPdf();
    await expect(
      redactFile("scan.pdf", scan, anonymizeDeterministic, { scanOcr: true, ocr: ocrOf(lowConf) }),
    ).rejects.toThrow("SCAN_LOW_CONFIDENCE");
  });

  it("does NOT route to OCR when the flag is OFF — a scan hits the NO_TEXT_LAYER refusal", async () => {
    const scan = await buildScanPdf();
    await expect(redactFile("scan.pdf", scan, anonymizeDeterministic, { scanOcr: false })).rejects.toThrow(
      "NO_TEXT_LAYER",
    );
  });
});
