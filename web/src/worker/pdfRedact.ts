/**
 * PDF redaction (PDF-03/04) — worker side. This module holds the mupdf plumbing; the pure text math is
 * in engine/pdfText. Stage 1 provides mapped extraction (logical text + per-char quads); the redaction
 * pipeline (Redact annotations + applyRedactions + safe save + self-verify) is added in stage 2.
 *
 * mupdf is dynamically imported so it loads only when a PDF is actually processed (P0I-02).
 */
import { buildMappedText, type CharBox, type MappedText, type PageLines } from "@engine/pdfText";

// reason: mupdf's ESM/WASM surface (Document, StructuredText walker) is not worth modelling in the
// type system; it is narrowly used here and behind a dynamic import.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Extract a PDF into one logical text stream with a quad attached to every character (engine/pdfText).
 * Uses mupdf's structured-text walk() emission order as the logical text — mupdf already applies bidi,
 * so a real (Word/Chrome-shaped) PDF yields Hebrew names in logical order. Line structure comes from
 * the walk's beginLine/endLine callbacks.
 */
export async function extractPdfMapped(buffer: ArrayBuffer): Promise<MappedText> {
  const mupdf: any = await import("mupdf");
  const doc = mupdf.Document.openDocument(new Uint8Array(buffer), "application/pdf");
  const pages: PageLines[] = [];
  const pageCount: number = doc.countPages();

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const structured = doc.loadPage(pageIndex).toStructuredText("preserve-whitespace");
    const lines: { chars: CharBox[] }[] = [];
    let current: CharBox[] | null = null;
    structured.walk({
      beginLine() {
        current = [];
      },
      endLine() {
        if (current) {
          lines.push({ chars: current });
          current = null;
        }
      },
      onChar(char: string, _origin: unknown, _font: unknown, _size: unknown, quad: ArrayLike<number>) {
        if (current) {
          current.push({ char, quad: Array.from(quad) });
        }
      },
    });
    pages.push({ pageIndex, lines });
  }

  return buildMappedText(pages);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
