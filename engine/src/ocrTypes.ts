/**
 * OCR result shapes — pure, framework-free, so the scan-quality gate (engine/scanGate) and the
 * coordinate mapping can be unit-tested with plain fixtures, no tesseract/DOM. The heavy tesseract
 * worker (web/src/worker/ocr) produces these; the engine only reasons about them.
 *
 * Coordinates are in IMAGE PIXELS of the rendered scan page (the space tesseract reports in). Mapping
 * to PDF points happens later, in the redaction path.
 */

export interface OcrBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface OcrWord {
  readonly text: string;
  /** 0–100, tesseract's per-word confidence. */
  readonly confidence: number;
  /** Bounding box in image pixels. */
  readonly bbox: OcrBox;
}

export interface OcrPageResult {
  readonly words: readonly OcrWord[];
  /** 0–100 page mean, as tesseract reports it. */
  readonly meanConfidence: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
}
