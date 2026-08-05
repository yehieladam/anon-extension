/**
 * Scanned-PDF redaction (OCR Stage 3) — worker side. Holds the mupdf plumbing; the pure detection math
 * is in engine/detectScanPii and the px->pt geometry in engine/ocrMap. A scanned page has no text
 * layer, so we RASTERIZE it, OCR the raster, detect PII on the OCR words, map their pixel boxes to page
 * points, and truly remove the covered pixels with REDACT_IMAGE_PIXELS.
 *
 * The OCR primitive is INJECTED (like `anonymize`): the browser wires ocr.ts (vendored tesseract in the
 * worker); the node reality test injects a node tesseract. So this module is testable end-to-end without
 * a DOM, and the engine stays framework-free.
 *
 * Whole-file refusal (Stage-1/3 rulings): ANY page failing the scan-quality gate (SCAN_LOW_CONFIDENCE)
 * or yielding an unmappable standard detection (SCAN_UNMAPPABLE_PII) throws before any bytes are
 * returned — never hand back a doc where one page is unreliable.
 */
import { evaluateScanQuality, SCAN_LOW_CONFIDENCE } from "@engine/scanGate";
import { detectScanPii, type ScanDetection } from "@engine/detectScanPii";
import { imageBoxToPageRect } from "@engine/ocrMap";
import type { OcrPageResult } from "@engine/ocrTypes";
import type { AnonymizeResult, KeyRow } from "@engine/types";
import { sanitizeMetadata } from "./pdfSanitize";
import { ocrImage } from "./ocr";
import type { RedactedFile, Anonymize } from "./officeRedact";

// reason: mupdf's ESM/WASM surface (PDFDocument, PDFPage, Pixmap, Matrix) is not worth modelling; it is
// narrowly used here and behind a dynamic import.
/* eslint-disable @typescript-eslint/no-explicit-any */

export { SCAN_LOW_CONFIDENCE } from "@engine/scanGate";
export { SCAN_UNMAPPABLE_PII } from "@engine/detectScanPii";

/** Injected OCR primitive: a rendered scan-page PNG -> words+bboxes. Browser=ocr.ts, node test=tesseract. */
export type ScanOcr = (png: Uint8Array) => Promise<OcrPageResult>;

/** Injected detector (defaults to the full detectScanPii). The node reality test overrides it to
 * exercise a single mechanism (e.g. label-anchor only) through the real pixel-redaction path. */
export type ScanDetect = (page: OcrPageResult) => Promise<ScanDetection>;

/** Fixed render resolution for OCR (Stage-1 calibration: 200 DPI keeps heb+eng clean; see docs/ocr-calibration.md). */
const OCR_RENDER_DPI = 200;

/** Same proven garbage-collecting save options as the text path (spikes/pdf-01) — never incremental. */
const SAFE_SAVE_OPTIONS = { garbage: "deduplicate", compress: true, sanitize: true } as const;

/**
 * Redact a scanned PDF page-by-page: rasterize -> OCR -> quality gate -> detectScanPii (standard + the
 * three content mechanisms) -> px->pt mapped, inflated rects -> Redact annotations -> REDACT_IMAGE_PIXELS.
 * Metadata is stripped and the file saved with the garbage-collecting options. The restore key is
 * best-effort from standard detections only (content-mechanism regions have no recoverable value).
 */
export async function redactScan(
  buffer: ArrayBuffer,
  anonymize: Anonymize,
  ocr: ScanOcr = ocrImage,
  detect: ScanDetect = (page) => detectScanPii(page, anonymize),
): Promise<RedactedFile> {
  const mupdf: any = await import("mupdf");
  const doc = mupdf.PDFDocument.openDocument(new Uint8Array(buffer), "application/pdf");
  const PDFPage = mupdf.PDFPage;
  const scale = OCR_RENDER_DPI / 72;
  const keyRows: KeyRow[] = [];

  const pageCount: number = doc.countPages();
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = doc.loadPage(pageIndex);
    const bounds = page.getBounds(); // [x0, y0, x1, y1] in points (presented orientation)

    // Rasterize at the calibrated DPI and OCR the raster (a scan has no text layer to read).
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    const image = { width: pixmap.getWidth(), height: pixmap.getHeight() };
    const ocrPage = await ocr(new Uint8Array(pixmap.asPNG()));

    // Quality gate: an unreliable page refuses the WHOLE file (never partially redact a scan we can't read).
    if (!evaluateScanQuality(ocrPage).ok) {
      throw new Error(SCAN_LOW_CONFIDENCE);
    }

    // Detect (may throw SCAN_UNMAPPABLE_PII on a standard match we cannot cover).
    const detection = await detect(ocrPage);
    keyRows.push(...detection.result.key);

    const pageBox = {
      widthPt: bounds[2] - bounds[0],
      heightPt: bounds[3] - bounds[1],
      originX: bounds[0],
      originY: bounds[1],
    };
    let touched = false;
    for (const box of detection.boxes) {
      const rect = imageBoxToPageRect(box, image, pageBox, {}); // {} -> apply the default over-cover inflation
      const annot = page.createAnnotation("Redact");
      annot.setRect([rect.x0, rect.y0, rect.x1, rect.y1]);
      annot.update();
      touched = true;
    }
    if (touched) {
      page.applyRedactions(true, PDFPage.REDACT_IMAGE_PIXELS, PDFPage.REDACT_LINE_ART_NONE, PDFPage.REDACT_TEXT_REMOVE);
    }
  }

  // Strip the invisible metadata leak channels (Info, XMP, embedded files, annotation text).
  sanitizeMetadata(doc);

  // Copy out of WASM memory before returning (asUint8Array is a live view).
  const bytes = new Uint8Array(doc.saveToBuffer(SAFE_SAVE_OPTIONS).asUint8Array());
  // Stage-4 seam: re-OCR self-verify of `bytes` (re-detect the output, assert no PII) lands next.
  const result: AnonymizeResult = { anonymizedText: "", spans: [], key: keyRows };
  return { bytes, result };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
