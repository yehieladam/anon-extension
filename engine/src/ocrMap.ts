/**
 * OCR coordinate mapping (OCR Stage 2) — pure, framework-free (no mupdf, no tesseract), so it is fully
 * unit-testable with plain fixtures. Mirrors the proven engine/pdfText (pure) <-> web/worker/pdfRedact
 * (mupdf) split: this module turns tesseract word boxes (IMAGE PIXELS) into redaction rectangles in
 * mupdf PAGE POINTS; the worker feeds those to REDACT_IMAGE_PIXELS in Stage 3.
 *
 * THE HANDEDNESS (load-bearing, do not "fix"): tesseract reports image-pixel boxes origin TOP-LEFT,
 * y-DOWN; mupdf.js page space (the space RedactRect / setRect consume — see engine/pdfText RedactRect
 * and web/worker/pdfRedact) is ALSO origin top-left, y-DOWN. Same handedness. So the mapping is a pure
 * per-axis SCALE plus the page-bounds ORIGIN offset — NO y-flip. Flipping against page height would be
 * wrong and would only accidentally work for boxes symmetric about the page centre (the worst kind of
 * bug). v1 assumes the scan is a single full-page raster at uniform scale (the case this track exists
 * for); a scan embedded as a sub-rect of a larger page is a documented v2 extension. Page rotation is
 * handled by rasterizing in mupdf's presented orientation (Stage 3), so px and pt share orientation
 * here.
 */
import type { OcrWord } from "./ocrTypes";

/** Axis-aligned rectangle. Space depends on context: image pixels on input, mupdf page points on output. */
export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Rendered-scan image dimensions in pixels (from OcrPageResult). */
export interface ImageDims {
  readonly width: number;
  readonly height: number;
}

/** The target page in mupdf points: size + optional bounds origin (non-zero for a shifted CropBox). */
export interface PageBox {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly originX?: number;
  readonly originY?: number;
}

/** Over-cover defaults (safe constants, not corpus-calibrated — over-covering only whites out a hair
 * more scan area, always the safe direction). Pad scales with glyph height so it is DPI/font invariant. */
export const PAD_FRACTION = 0.15;
export const PAD_MIN_PT = 1.0;

/** The page as a rect in its own point space (for clamping). */
export function pageBounds(page: PageBox): Rect {
  const ox = page.originX ?? 0;
  const oy = page.originY ?? 0;
  return { x0: ox, y0: oy, x1: ox + page.widthPt, y1: oy + page.heightPt };
}

/** Symmetric over-cover pad for a box of the given point height: max(fraction * height, floor). */
export function padForHeight(heightPt: number, fraction: number = PAD_FRACTION, minPt: number = PAD_MIN_PT): number {
  return Math.max(fraction * heightPt, minPt);
}

/** Grow a rect by padPt on every side, then clamp to bounds (a PII at the page edge must stay in-page). */
export function inflateRect(rect: Rect, padPt: number, bounds: Rect): Rect {
  return {
    x0: Math.max(bounds.x0, rect.x0 - padPt),
    y0: Math.max(bounds.y0, rect.y0 - padPt),
    x1: Math.min(bounds.x1, rect.x1 + padPt),
    y1: Math.min(bounds.y1, rect.y1 + padPt),
  };
}

/** Smallest rect covering all inputs (a multi-word PII on one line unions its word boxes). */
export function unionRect(rects: readonly Rect[]): Rect {
  if (rects.length === 0) {
    throw new Error("unionRect: no rects");
  }
  return rects.reduce((acc, r) => ({
    x0: Math.min(acc.x0, r.x0),
    y0: Math.min(acc.y0, r.y0),
    x1: Math.max(acc.x1, r.x1),
    y1: Math.max(acc.y1, r.y1),
  }));
}

/**
 * Map one image-pixel box to a page-point rect: per-axis scale (robust to rounding and any non-uniform
 * render — no DPI constant) + origin offset, NO y-flip. When `inflate` is given, over-cover by
 * padForHeight(mapped height) on each side and clamp to the page; omit it for the exact pre-inflation
 * mapping.
 */
export function imageBoxToPageRect(
  box: Rect,
  image: ImageDims,
  page: PageBox,
  inflate?: { readonly fraction?: number; readonly minPt?: number },
): Rect {
  const scaleX = page.widthPt / image.width;
  const scaleY = page.heightPt / image.height;
  const ox = page.originX ?? 0;
  const oy = page.originY ?? 0;
  const mapped: Rect = {
    x0: ox + box.x0 * scaleX,
    y0: oy + box.y0 * scaleY,
    x1: ox + box.x1 * scaleX,
    y1: oy + box.y1 * scaleY,
  };
  if (!inflate) {
    return mapped;
  }
  const pad = padForHeight(mapped.y1 - mapped.y0, inflate.fraction, inflate.minPt);
  return inflateRect(mapped, pad, pageBounds(page));
}

/** A per-word char range in the concatenated OCR text. */
export interface WordRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Concatenate the OCR words into a single detection string (single-space separated), recording each
 * word's [start, end) char range. Stage 3 runs PII detection on `text`, then maps each matched range
 * back to covering word indices via wordsForRange — the OCR analog of pdfText's quadsForSpan. Word order
 * and boxes are preserved so Stage 3's label-anchored redaction can find the value box next to a label.
 */
export function buildOcrText(words: readonly Pick<OcrWord, "text">[]): { text: string; ranges: readonly WordRange[] } {
  let text = "";
  const ranges: WordRange[] = [];
  words.forEach((word, index) => {
    if (index > 0) {
      text += " ";
    }
    const start = text.length;
    text += word.text;
    ranges.push({ start, end: text.length });
  });
  return { text, ranges };
}

/** Indices of the words whose char range overlaps [start, end) — the words a detected span covers. */
export function wordsForRange(ranges: readonly WordRange[], start: number, end: number): number[] {
  const out: number[] = [];
  ranges.forEach((range, index) => {
    if (range.start < end && range.end > start) {
      out.push(index);
    }
  });
  return out;
}
