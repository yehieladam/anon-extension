/**
 * Scan-mode PII detection (Stage 3) — pure, model-free. Pins the three content mechanisms against the
 * calibration findings: label-anchor (merged token + bare label with same-line value chase), digit-run
 * relax (8-10 digits, checksum-optional, scan-only), and the zero-cover hard refusal. Model-free: NER
 * cases use a stub anonymize; deterministic isolation uses a no-op.
 */
import { describe, expect, it } from "vitest";
import { detectScanPii, SCAN_UNMAPPABLE_PII, type Anonymize } from "./detectScanPii";
import { anonymizeDeterministic } from "./pipeline";
import { anonymize as tokenize } from "./anonymize";
import { markScanKeySources, scanTextLeaks } from "./scanKey";
import { restore } from "./restore";
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

describe("detectScanPii — Stage-4 self-verify verdict basis", () => {
  // Self-verify re-runs detectScanPii on the re-OCR and refuses on ANY box. These pin that verdict input.
  it("P1. a clean (no-PII) page yields zero boxes (verify would PASS)", async () => {
    const { boxes } = await detectScanPii(pageOf([w("סוף", 0, 60), w("המסמך", 70, 200)]), NOOP);
    expect(boxes).toHaveLength(0);
  });

  it("P2. a residual valid ID re-detects to a box (verify would FAIL)", async () => {
    const { boxes } = await detectScanPii(pageOf([w("123456709", 0, 180)]), anonymizeDeterministic);
    expect(boxes.length).toBeGreaterThan(0);
  });
});

// --- Stage 6: the unified span set drives the tokenized "Word for AI" text consistently with the pixels.
/** Reproduce redactScan's document tokenize: detectScanPii spans -> tokenized text + fidelity-marked key. */
async function tokenizeScan(page: OcrPageResult, anonymize: Anonymize) {
  const { spans, text, boxes } = await detectScanPii(page, anonymize);
  const t = tokenize(text, spans);
  return { text: t.anonymizedText, key: markScanKeySources(t.key), boxCount: boxes.length };
}
/** Lay words left-to-right on one line (y 0..20) with a small gap. */
function line(...texts: string[]): OcrWord[] {
  return lineAt(0, ...texts);
}
/** Lay words on a text line at vertical band [y, y+20] — separate lines so label-anchor stays per-field. */
function lineAt(y: number, ...texts: string[]): OcrWord[] {
  let x = 0;
  return texts.map((txt) => {
    const width = Math.max(30, txt.length * 12);
    const word = w(txt, x, x + width, y, y + 20);
    x += width + 10;
    return word;
  });
}

describe("detectScanPii — Stage 6 tokenized text (AI-usable, consistent with pixels)", () => {
  it("1. CONSISTENCY INVARIANT: every covered value (A + B + C) is tokenized — no raw PII in the text", async () => {
    // Realistic multi-line doc: C (ID label + garbled value) on one line, A (valid ID) on the next, B
    // (an unlabeled 8-digit date) on a third — each field its own line, as in a real form.
    const words = [
      ...lineAt(0, "תעודת", "זהות", "פוווווווו"),
      ...lineAt(40, "מזהה", "123456709"),
      ...lineAt(80, "בתאריך", "01012024"),
    ];
    const { text, key } = await tokenizeScan(pageOf(words), anonymizeDeterministic);
    expect(text).not.toContain("123456709"); // A valid ID gone
    expect(text).not.toContain("פוווווווו"); // C garbled value gone
    expect(text).not.toContain("01012024"); // B digit-run (over-redacted date) gone
    expect(text).toContain("[ת״ז_"); // typed tokens present
    expect(text).toContain("[מספר_"); // B generic-number token present
    expect(scanTextLeaks(text, key)).toHaveLength(0); // no validated original survives
  });

  it("2. unified per-type numbering + one key across mechanisms", async () => {
    const words = [...lineAt(0, "תעודת", "זהות", "123456709"), ...lineAt(40, "טלפון", "0521234567")];
    const { text, key } = await tokenizeScan(pageOf(words), anonymizeDeterministic);
    expect(text).toContain("[ת״ז_1]");
    expect(text).toContain("[טלפון_1]");
    expect(key.some((r) => r.placeholder === "[ת״ז_1]")).toBe(true);
    expect(key.some((r) => r.placeholder === "[טלפון_1]")).toBe(true);
  });

  it("3. a value caught by BOTH A (validated) and C (labeled) is ONE token, not two", async () => {
    // "תעודת זהות 123456709": A validates the ID, C anchors label+value. Overlap resolves to one span.
    const words = line("תעודת", "זהות", "123456709");
    const { text } = await tokenizeScan(pageOf(words), anonymizeDeterministic);
    expect((text.match(/\[ת״ז_\d+\]/g) ?? []).length).toBe(1);
    expect(text).not.toContain("123456709");
  });

  it("5. an unreadable labeled value keeps a typed token but the key row is flagged unreadable", async () => {
    const words = line("תעודת", "זהות", "פוווווווו"); // label + garbled (no digits)
    const { text, key } = await tokenizeScan(pageOf(words), NOOP);
    expect(text).toContain("[ת״ז_1]");
    const row = key.find((r) => r.placeholder === "[ת״ז_1]");
    expect(row?.source).toBe("unreadable"); // never a silent wrong restore
  });

  it("6. a B generic-number token round-trips via restore to the OCR-read digits", async () => {
    const words = line("סכום", "87654321"); // unlabeled 8-digit run -> [מספר_1]
    const { text, key } = await tokenizeScan(pageOf(words), NOOP);
    expect(text).toContain("[מספר_1]");
    expect(restore(text, key).restoredText).toContain("87654321"); // round-trips
  });

  it("7. text self-verify catches a validated original left un-tokenized (a tokenization bug)", () => {
    // A key says [ת״ז_1]->123456709 (validated) but the text still contains the raw ID -> a leak.
    const leaks = scanTextLeaks("שם [שם_1] ת״ז 123456709", [
      { placeholder: "[ת״ז_1]", original: "123456709", type: "ISRAELI_ID", source: "validated" },
    ]);
    expect(leaks).toContain("123456709");
  });
});

describe("scan tokenize — multi-page coherence (redactScan concatenation logic)", () => {
  it("4. the same value on two pages gets the same token via the combined tokenize", async () => {
    // Simulate redactScan: two pages, spans shifted to the combined offset, one tokenize pass.
    const p1 = await detectScanPii(pageOf(line("טלפון", "0521234567")), anonymizeDeterministic);
    const p2 = await detectScanPii(pageOf(line("נייד", "0521234567")), anonymizeDeterministic);
    const combined = `${p1.text}\n\n${p2.text}`;
    const shift = p1.text.length + 2;
    const spans = [...p1.spans, ...p2.spans.map((s) => ({ ...s, start: s.start + shift, end: s.end + shift }))];
    const t = tokenize(combined, spans);
    // one phone value across both pages -> a single [טלפון_1], one key row.
    expect((t.anonymizedText.match(/\[טלפון_1\]/g) ?? []).length).toBe(2);
    expect(t.key.filter((r) => r.type === "IL_PHONE")).toHaveLength(1);
    expect(t.anonymizedText).not.toContain("0521234567");
  });
});
