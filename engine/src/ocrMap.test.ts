/**
 * OCR coordinate mapping (Stage 2) — pins the pure px->pt transform. The load-bearing test is #2:
 * NO y-flip (tesseract image-px and mupdf page-pt share top-left/y-down handedness). Also pins per-axis
 * scale, origin offset, height-fraction inflation with a floor, clamp-to-page, union, and span->words.
 */
import { describe, expect, it } from "vitest";
import {
  imageBoxToPageRect,
  inflateRect,
  unionRect,
  padForHeight,
  pageBounds,
  buildOcrText,
  wordsForRange,
  PAD_FRACTION,
  PAD_MIN_PT,
} from "./ocrMap";

// 200-DPI Letter scan: 1700x2200 px -> 612x792 pt (uniform x0.36).
const image = { width: 1700, height: 2200 };
const page = { widthPt: 612, heightPt: 792 };

describe("imageBoxToPageRect", () => {
  it("1. scales image px to page pt exactly (x0.36), pre-inflation", () => {
    const r = imageBoxToPageRect({ x0: 100, y0: 100, x1: 300, y1: 140 }, image, page);
    expect(r.x0).toBeCloseTo(36, 6);
    expect(r.y0).toBeCloseTo(36, 6);
    expect(r.x1).toBeCloseTo(108, 6);
    expect(r.y1).toBeCloseTo(50.4, 6);
  });

  it("2. does NOT y-flip: a box near the image TOP maps to a SMALL y (page top)", () => {
    const r = imageBoxToPageRect({ x0: 100, y0: 20, x1: 300, y1: 60 }, image, page);
    // y-down preserved: top-of-image -> top-of-page (small y), never page.heightPt - y.
    expect(r.y0).toBeCloseTo(20 * 0.36, 6); // 7.2
    expect(r.y0).toBeLessThan(page.heightPt / 2);
    // A y-flip would have produced ~792 - 7.2; assert we are nowhere near it.
    expect(r.y0).not.toBeCloseTo(792 - 20 * 0.36, 1);
  });

  it("3. applies the page-bounds origin offset", () => {
    const shifted = { widthPt: 612, heightPt: 792, originX: 10, originY: 20 };
    const r = imageBoxToPageRect({ x0: 100, y0: 100, x1: 300, y1: 140 }, image, shifted);
    expect(r.x0).toBeCloseTo(10 + 36, 6);
    expect(r.y0).toBeCloseTo(20 + 36, 6);
    expect(r.x1).toBeCloseTo(10 + 108, 6);
    expect(r.y1).toBeCloseTo(20 + 50.4, 6);
  });

  it("4. inflation uses the height fraction (box 40px -> 14.4pt -> pad 2.16pt each side)", () => {
    const r = imageBoxToPageRect({ x0: 100, y0: 100, x1: 300, y1: 140 }, image, page, {});
    // mapped y span 36..50.4 (14.4pt); pad = max(0.15*14.4, 1.0) = 2.16
    expect(r.y0).toBeCloseTo(36 - 2.16, 6);
    expect(r.y1).toBeCloseTo(50.4 + 2.16, 6);
    expect(r.x0).toBeCloseTo(36 - 2.16, 6);
    expect(r.x1).toBeCloseTo(108 + 2.16, 6);
  });

  it("8. handles per-axis scale independently (image aspect != page aspect)", () => {
    const wideImage = { width: 1000, height: 2000 };
    const squarePage = { widthPt: 500, heightPt: 500 }; // scaleX 0.5, scaleY 0.25
    const r = imageBoxToPageRect({ x0: 100, y0: 100, x1: 200, y1: 200 }, wideImage, squarePage);
    expect(r.x0).toBeCloseTo(50, 6);
    expect(r.y0).toBeCloseTo(25, 6);
    expect(r.x1).toBeCloseTo(100, 6);
    expect(r.y1).toBeCloseTo(50, 6);
  });

  it("9. clamps an edge box whose inflation would exceed the page bounds", () => {
    // Box hugging the top-left corner: mapped to (0,0,..); inflation must not go negative.
    const r = imageBoxToPageRect({ x0: 0, y0: 0, x1: 100, y1: 40 }, image, page, {});
    expect(r.x0).toBe(0);
    expect(r.y0).toBe(0);
    // Bottom-right corner box: must not exceed page width/height.
    const br = imageBoxToPageRect({ x0: 1600, y0: 2160, x1: 1700, y1: 2200 }, image, page, {});
    expect(br.x1).toBeLessThanOrEqual(page.widthPt);
    expect(br.y1).toBeLessThanOrEqual(page.heightPt);
    expect(br.x1).toBe(page.widthPt);
    expect(br.y1).toBe(page.heightPt);
  });
});

describe("padForHeight", () => {
  it("4b. fraction dominates above the floor", () => {
    expect(padForHeight(14.4)).toBeCloseTo(2.16, 6); // 0.15 * 14.4
    expect(PAD_FRACTION).toBe(0.15);
  });

  it("5. the minimum-pad floor wins for a tiny box (2px -> 0.72pt -> pad 1.0)", () => {
    expect(padForHeight(0.72)).toBe(1.0); // max(0.108, 1.0)
    expect(PAD_MIN_PT).toBe(1.0);
  });
});

describe("inflateRect + unionRect", () => {
  it("6. unions two adjacent word boxes then inflates the union", () => {
    const a = { x0: 36, y0: 36, x1: 60, y1: 50 };
    const b = { x0: 64, y0: 37, x1: 108, y1: 51 };
    const u = unionRect([a, b]);
    expect(u).toEqual({ x0: 36, y0: 36, x1: 108, y1: 51 });
    const inflated = inflateRect(u, 2, pageBounds(page));
    expect(inflated).toEqual({ x0: 34, y0: 34, x1: 110, y1: 53 });
  });

  it("clamps the inflated union to page bounds", () => {
    const edge = { x0: 1, y0: 1, x1: 611, y1: 791 };
    const inflated = inflateRect(edge, 5, pageBounds(page));
    expect(inflated).toEqual({ x0: 0, y0: 0, x1: 612, y1: 792 });
  });
});

describe("buildOcrText + wordsForRange", () => {
  it("7. maps a detected span back to its covering word indices", () => {
    const words = [{ text: "שם" }, { text: "משה" }, { text: "כהן" }, { text: "טלפון" }];
    const { text, ranges } = buildOcrText(words);
    expect(text).toBe("שם משה כהן טלפון");
    // "משה כהן" occupies chars [3,10)
    const start = text.indexOf("משה");
    const end = text.indexOf("כהן") + "כהן".length;
    expect(wordsForRange(ranges, start, end)).toEqual([1, 2]);
  });

  it("maps a single-word match to one index and preserves word order", () => {
    const words = [{ text: "לכבוד" }, { text: "מרים" }, { text: "אלון" }];
    const { text, ranges } = buildOcrText(words);
    const start = text.indexOf("אלון");
    expect(wordsForRange(ranges, start, start + "אלון".length)).toEqual([2]);
  });
});
