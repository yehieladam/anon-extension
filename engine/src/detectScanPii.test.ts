/**
 * Scan-mode PII detection (Stage 3) — pure, model-free. Pins the three content mechanisms against the
 * calibration findings: label-anchor (merged token + bare label with same-line value chase), digit-run
 * relax (8-10 digits, checksum-optional, scan-only), and the zero-cover hard refusal. Model-free: NER
 * cases use a stub anonymize; deterministic isolation uses a no-op.
 */
import { describe, expect, it } from "vitest";
import { detectScanPii, SCAN_UNMAPPABLE_PII, type Anonymize } from "./detectScanPii";
import { anonymizeDeterministic } from "./pipeline";
import type { OcrBox, OcrPageResult, OcrWord } from "./ocrTypes";
import type { Span } from "./types";

/** A word on a single text line (y 0..20 by default) spanning [x0,x1]. */
function w(text: string, x0: number, x1: number, y0 = 0, y1 = 20): OcrWord {
  return { text, confidence: 90, bbox: { x0, y0, x1, y1 } };
}
function pageOf(words: OcrWord[]): OcrPageResult {
  return { words, meanConfidence: 90, imageWidth: 2000, imageHeight: 100 };
}
const NOOP: Anonymize = () => ({ anonymizedText: "", spans: [], key: [] });
const stub =
  (spans: Span[]): Anonymize =>
  (text) => ({ anonymizedText: text, spans, key: [] });

/** Does any redaction box cover the given word box (bboxes equal or the box contains it)? */
function covers(boxes: readonly OcrBox[], target: OcrBox): boolean {
  return boxes.some((b) => b.x0 <= target.x0 && b.y0 <= target.y0 && b.x1 >= target.x1 && b.y1 >= target.y1);
}

describe("detectScanPii — label-anchor (C)", () => {
  it("1. redacts a merged label+value token (label + digits in one token)", async () => {
    const word = w("תעודתזהות111111118", 100, 400);
    const { boxes } = await detectScanPii(pageOf([word]), NOOP);
    expect(covers(boxes, word.bbox)).toBe(true);
  });

  it("2. redacts the d2 shape: label merged with a garbage (letters) value", async () => {
    // OCR read the all-1s ID as Hebrew vav glyphs, merged into the label token. Zero digits -> only the
    // label-anchor can see it.
    const word = w("מספרזהותפוווווווו", 100, 420);
    const { boxes } = await detectScanPii(pageOf([word]), NOOP);
    expect(covers(boxes, word.bbox)).toBe(true);
  });

  it("3. redacts a bare label plus its same-line value word", async () => {
    const label = w('ת"ז', 100, 160);
    const value = w("123456709", 170, 320);
    const { boxes } = await detectScanPii(pageOf([label, value]), NOOP);
    // union covers both
    expect(covers(boxes, { x0: 100, y0: 0, x1: 320, y1: 20 })).toBe(true);
  });

  it("4. redacts a bare label plus a 2-word name (label + 2 neighbors, cap 3)", async () => {
    const label = w("שם", 100, 150);
    const first = w("משה", 160, 230);
    const last = w("כהן", 240, 310);
    const { boxes } = await detectScanPii(pageOf([label, first, last]), NOOP);
    expect(covers(boxes, { x0: 100, y0: 0, x1: 310, y1: 20 })).toBe(true);
  });

  it("5. stops the value chase at a large gap (next field not swept in)", async () => {
    const label = w("טלפון", 100, 200);
    const phone = w("052-1234567", 210, 400);
    const far = w("כתובת", 900, 1000); // big gap -> different field
    const { boxes } = await detectScanPii(pageOf([label, phone, far]), NOOP);
    expect(covers(boxes, phone.bbox)).toBe(true);
    expect(covers(boxes, far.bbox)).toBe(false);
  });

  it("6. no false anchor on a label-free, digit-free line", async () => {
    const { boxes } = await detectScanPii(pageOf([w("שלום", 0, 80), w("עולם", 90, 170), w("כאן", 180, 240)]), NOOP);
    expect(boxes).toHaveLength(0);
  });
});

describe("detectScanPii — digit-run relax (B)", () => {
  it("7. redacts 8/9(invalid)/10-digit runs, never 7 or 11", async () => {
    const eight = w("12345678", 0, 100);
    const nineInvalid = w("123456780", 120, 240); // 9 digits, fails ID checksum
    const ten = w("1234567890", 260, 420);
    const seven = w("1234567", 440, 520);
    const eleven = w("12345678901", 540, 700);
    const { boxes } = await detectScanPii(pageOf([eight, nineInvalid, ten, seven, eleven]), NOOP);
    expect(covers(boxes, eight.bbox)).toBe(true);
    expect(covers(boxes, nineInvalid.bbox)).toBe(true);
    expect(covers(boxes, ten.bbox)).toBe(true);
    expect(covers(boxes, seven.bbox)).toBe(false);
    expect(covers(boxes, eleven.bbox)).toBe(false);
  });

  it("8. the relaxation is scan-only: the digital-text path keeps the ID checksum", () => {
    // Structural isolation proof: anonymizeDeterministic (the text-path detector) does NOT flag an
    // invalid 9-digit number; only detectScanPii relaxes it. A boolean flag could be mis-set; a
    // separate entrypoint keyed on OCR input cannot.
    const result = anonymizeDeterministic("123456780");
    expect(result.spans.filter((s) => s.type === "ISRAELI_ID")).toHaveLength(0);
  });
});

describe("detectScanPii — standard (A) + zero-cover refusal", () => {
  it("9. throws SCAN_UNMAPPABLE_PII when a standard match maps to zero word boxes", async () => {
    const page = pageOf([w("אבג", 0, 60)]); // text "אבג", range [0,3]
    const beyond = stub([{ start: 10, end: 15, type: "PERSON", score: 0.9 }]); // maps to no words
    await expect(detectScanPii(page, beyond)).rejects.toThrow(SCAN_UNMAPPABLE_PII);
  });

  it("10. unions a multi-word name (span across 2 boxes) into one covering rect", async () => {
    const first = w("משה", 0, 70); // "משה" [0,3]
    const last = w("כהן", 80, 150); // "כהן" [4,7]
    const person = stub([{ start: 0, end: 7, type: "PERSON", score: 0.95 }]);
    const { boxes } = await detectScanPii(pageOf([first, last]), person);
    expect(boxes).toContainEqual({ x0: 0, y0: 0, x1: 150, y1: 20 });
  });
});
