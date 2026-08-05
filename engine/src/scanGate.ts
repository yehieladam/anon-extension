/**
 * Scan-quality gate — the honesty guarantee of the scanned-PDF (OCR) track, and its SOLE defense
 * against silently-dropped PII.
 *
 * THE CRUX (do not weaken): OCR's dangerous failure is not a low-confidence word — it is a word the
 * engine never emits at all. A dropped word has no bbox and no confidence entry, so it is invisible to
 * any per-word confidence check AND to the re-OCR self-verify (re-OCR of a still-present name just
 * drops it again, so the verify passes falsely). In the PDF-05a spike a noisy scan silently missed a
 * NAME at page-mean confidence 89 — an under-redaction under our own promise. Therefore the only
 * protection is a conservative WHOLE-PAGE quality bar that refuses the whole file when a page reads
 * poorly, erring toward refusal. Never turn this into a per-word pass/fail, and never lower the floor
 * to "rescue" a borderline scan — a scan we cannot read reliably must be refused, not partially
 * redacted. Thresholds are calibrated from a real synthetic-scan corpus in Stage 1 (OCR-01).
 */
import type { OcrPageResult, OcrWord } from "./ocrTypes";

// PLACEHOLDER — calibrated in Stage 1 (OCR-01). Floor sits above the spike's observed 89 failure.
const SCAN_MEAN_CONF_FLOOR = 90;
const LOW_CONF_WORD_FLOOR = 60;
const MAX_LOW_CONF_RATIO = 0.15;

/** Refusal code surfaced to the UI when a scan reads too poorly to redact reliably. */
export const SCAN_LOW_CONFIDENCE = "SCAN_LOW_CONFIDENCE";

export type ScanQuality = { readonly ok: true } | { readonly ok: false; readonly reason: typeof SCAN_LOW_CONFIDENCE };

/** Words that carry actual text (whitespace-only tokens must not skew the mean/ratio). */
function textWords(page: OcrPageResult): OcrWord[] {
  return page.words.filter((word) => word.text.trim().length > 0);
}

/**
 * Pass a page only when it reads cleanly on BOTH signals: a high page-mean confidence AND a small
 * fraction of low-confidence words. Either signal failing — or an empty/unreadable page — refuses.
 * Bounds are inclusive (>= floor, <= max ratio).
 */
export function evaluateScanQuality(page: OcrPageResult): ScanQuality {
  const words = textWords(page);
  if (words.length === 0) {
    return { ok: false, reason: SCAN_LOW_CONFIDENCE }; // unreadable → refuse, never silently pass
  }
  const meanConfidence = words.reduce((sum, word) => sum + word.confidence, 0) / words.length;
  const lowRatio = words.filter((word) => word.confidence < LOW_CONF_WORD_FLOOR).length / words.length;
  const ok = meanConfidence >= SCAN_MEAN_CONF_FLOOR && lowRatio <= MAX_LOW_CONF_RATIO;
  return ok ? { ok: true } : { ok: false, reason: SCAN_LOW_CONFIDENCE };
}
