/**
 * Scan-quality gate — the sole defense against silently-dropped OCR PII. These tests pin the
 * whole-page quality bar: both signals (page-mean confidence AND low-confidence-word ratio) must pass,
 * an unreadable page is refused, whitespace never skews the numbers, and the bounds are inclusive.
 */
import { describe, expect, it } from "vitest";
import { evaluateScanQuality, SCAN_LOW_CONFIDENCE } from "./scanGate";
import type { OcrPageResult, OcrWord } from "./ocrTypes";

const box = { x0: 0, y0: 0, x1: 10, y1: 10 };
const word = (confidence: number, text = "מ"): OcrWord => ({ text, confidence, bbox: box });

function page(words: OcrWord[]): OcrPageResult {
  const nonEmpty = words.filter((w) => w.text.trim().length > 0);
  const mean = nonEmpty.length ? nonEmpty.reduce((s, w) => s + w.confidence, 0) / nonEmpty.length : 0;
  return { words, meanConfidence: mean, imageWidth: 1000, imageHeight: 1400 };
}

describe("evaluateScanQuality", () => {
  it("1. passes a clean page (all words high, mean 91)", () => {
    expect(evaluateScanQuality(page([word(91), word(91), word(91)])).ok).toBe(true);
  });

  it("2. refuses the spike's noisy value (mean 89, below the floor)", () => {
    const result = evaluateScanQuality(page([word(89), word(89), word(89)]));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe(SCAN_LOW_CONFIDENCE);
  });

  it("3. refuses on the low-confidence-word ratio even when the mean passes", () => {
    // 16 high + 4 low(<60): mean 91 (>= floor), lowRatio 0.2 (> 0.15) → the second signal fires alone.
    const words = [...Array(16).fill(word(100)), ...Array(4).fill(word(55))];
    expect(evaluateScanQuality(page(words)).ok).toBe(false);
  });

  it("4. refuses an unreadable page (no text words)", () => {
    expect(evaluateScanQuality(page([])).ok).toBe(false);
    expect(evaluateScanQuality(page([word(99, "   ")])).ok).toBe(false);
  });

  it("5. accepts the exact inclusive boundary (mean = floor, ratio = max)", () => {
    // 3 low(58) of 20 → ratio exactly 0.15; high words tuned so the mean is exactly 90.
    const highConf = (90 * 20 - 3 * 58) / 17;
    const words = [...Array(3).fill(word(58)), ...Array(17).fill(word(highConf))];
    expect(evaluateScanQuality(page(words)).ok).toBe(true);
  });

  it("6. excludes whitespace-only words from the mean and ratio", () => {
    // Three real high words (mean 95) plus whitespace tokens with junk confidence that would sink a
    // naive average — the gate must ignore them and pass.
    const words = [word(95), word(95), word(95), word(1, " "), word(1, "\t")];
    expect(evaluateScanQuality(page(words)).ok).toBe(true);
  });
});
