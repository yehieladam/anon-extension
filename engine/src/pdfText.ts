/**
 * PDF text mapping (PDF-03) — turn a PDF's per-character glyph boxes into ONE logical text stream with
 * a quad attached to every code unit, so detection runs on readable text and each detected span maps
 * straight back to the rectangles to redact.
 *
 * Design decision (managed by Fable 5, from measured data): the logical text is mupdf's own `walk()`
 * emission order. mupdf already applies bidi; on a real (Word/Chrome-shaped) PDF it emits Hebrew names
 * in correct logical order. We do NOT re-order by geometry (x-sort logical for a synthetic
 * logical-authored PDF but REVERSES a real one — a silent name-leak risk) and we do NOT hand-roll the
 * Unicode Bidi Algorithm. On mixed Hebrew+number lines mupdf moves the number block to the front, but
 * that cannot hurt detection: deterministic PII (ID/phone/IBAN/company) is a contiguous LTR run and a
 * Hebrew name stays a contiguous logical run — recognizers and NER find both regardless of token
 * order. This module is pure and framework-free (no mupdf) so it is unit-testable; the worker feeds it
 * the walk output.
 */

/** One extracted character with its glyph quad (8 numbers: ul, ur, ll, lr corners). */
export interface CharBox {
  readonly char: string;
  readonly quad: readonly number[];
}

/** One page's lines, each a list of chars in walk() emission order. */
export interface PageLines {
  readonly pageIndex: number;
  readonly lines: ReadonlyArray<{ readonly chars: readonly CharBox[] }>;
}

/** Where one code unit of the logical text came from on the page. */
export interface CharRef {
  readonly pageIndex: number;
  readonly quad: readonly number[];
}

export interface MappedText {
  /** Logical text: lines joined by "\n", pages by "\n\n". Detection runs on this. */
  readonly text: string;
  /** One entry per UTF-16 code unit of `text`; null for the injected line/page separators. */
  readonly refs: ReadonlyArray<CharRef | null>;
}

/**
 * Build the mapped text. Each character contributes its code unit(s) to `text`, each carrying the same
 * CharRef (the char's page + quad); separators between lines/pages get a null ref. Offsets are UTF-16
 * code units, matching Span offsets (engine/types.ts).
 */
export function buildMappedText(pages: readonly PageLines[]): MappedText {
  let text = "";
  const refs: (CharRef | null)[] = [];

  pages.forEach((page, pageOrder) => {
    if (pageOrder > 0) {
      text += "\n";
      refs.push(null); // page separator (in addition to the trailing line separator below)
    }
    page.lines.forEach((line, lineOrder) => {
      if (lineOrder > 0) {
        text += "\n";
        refs.push(null);
      }
      for (const box of line.chars) {
        const ref: CharRef = { pageIndex: page.pageIndex, quad: box.quad };
        // One ref per UTF-16 code unit so offsets stay aligned with Span offsets.
        for (let i = 0; i < box.char.length; i += 1) {
          text += box.char[i];
          refs.push(ref);
        }
      }
    });
  });

  return { text, refs };
}

/**
 * Collect the distinct quads covering a [start, end) span of the mapped text (one per contributing
 * character, de-duplicated by identity). Separator positions (null refs) are skipped.
 */
export function quadsForSpan(mapped: MappedText, start: number, end: number): CharRef[] {
  const out: CharRef[] = [];
  const seen = new Set<readonly number[]>();
  for (let i = start; i < end && i < mapped.refs.length; i += 1) {
    const ref = mapped.refs[i];
    if (ref && !seen.has(ref.quad)) {
      seen.add(ref.quad);
      out.push(ref);
    }
  }
  return out;
}

/** An axis-aligned redaction rectangle on a page (mupdf page coordinates). */
export interface RedactRect {
  readonly pageIndex: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function quadBounds(quad: readonly number[]): { x0: number; y0: number; x1: number; y1: number } {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Do two vertical ranges overlap enough to be the same text line (share a baseline)? */
function sameLine(a: RedactRect, b: { y0: number; y1: number }): boolean {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return overlap > 0.4 * Math.min(a.y1 - a.y0, b.y1 - b.y0);
}

/**
 * Merge the per-character quads of a span into redaction rectangles: characters on the same page and
 * baseline union into one rect; a value that wraps to another line (or page) yields a rect per line.
 * This is what gets redacted — one clean box per line-run instead of a box per glyph.
 */
export function refsToRects(refs: readonly CharRef[]): RedactRect[] {
  const rects: RedactRect[] = [];
  let current: RedactRect | null = null;
  for (const ref of refs) {
    const b = quadBounds(ref.quad);
    if (current && current.pageIndex === ref.pageIndex && sameLine(current, b)) {
      current = {
        pageIndex: current.pageIndex,
        x0: Math.min(current.x0, b.x0),
        y0: Math.min(current.y0, b.y0),
        x1: Math.max(current.x1, b.x1),
        y1: Math.max(current.y1, b.y1),
      };
      rects[rects.length - 1] = current;
    } else {
      current = { pageIndex: ref.pageIndex, ...b };
      rects.push(current);
    }
  }
  return rects;
}
