/**
 * PDF redaction (PDF-03/04) — worker side. This module holds the mupdf plumbing; the pure text math is
 * in engine/pdfText. Stage 1 provides mapped extraction (logical text + per-char quads); the redaction
 * pipeline (Redact annotations + applyRedactions + safe save + self-verify) is added in stage 2.
 *
 * mupdf is dynamically imported so it loads only when a PDF is actually processed (P0I-02).
 */
import {
  buildMappedText,
  quadsForSpan,
  refsToRects,
  type CharBox,
  type MappedText,
  type PageLines,
  type RedactRect,
} from "@engine/pdfText";
import type { AnonymizeResult } from "@engine/types";
import { layerB, layerC, normalizeForLeak } from "@engine/pdfVerify";
import type { RedactedFile, Anonymize } from "./officeRedact";

// reason: mupdf's ESM/WASM surface (PDFDocument, PDFPage, StructuredText walker) is not worth
// modelling in the type system; it is narrowly used here and behind a dynamic import.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PROVEN save options (spikes/pdf-01, CLAUDE.md). A plain or compress-only save leaves the orphaned
 * pre-redaction content stream in the file; only garbage collection removes it. NEVER incremental,
 * NEVER a save without garbage — the raw-byte self-verify below is the backstop either way.
 */
const SAFE_SAVE_OPTIONS = { garbage: "deduplicate", compress: true, sanitize: true } as const;

/** Build the mapped text from an already-open mupdf document (shared by extract + redact). */
function mappedFromDoc(doc: any): MappedText {
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

/**
 * Extract a PDF into one logical text stream with a quad attached to every character (engine/pdfText).
 * Uses mupdf's walk() emission order — mupdf applies bidi, so a real (Word/Chrome-shaped) PDF yields
 * Hebrew names in logical order.
 */
export async function extractPdfMapped(buffer: ArrayBuffer): Promise<MappedText> {
  const mupdf: any = await import("mupdf");
  const doc = mupdf.PDFDocument.openDocument(new Uint8Array(buffer), "application/pdf");
  return mappedFromDoc(doc);
}

/** Re-extract the redacted bytes through the SAME pipeline and assert no detected value survives. */
async function selfVerify(bytes: Uint8Array, needles: readonly string[]): Promise<void> {
  if (needles.length === 0) {
    return;
  }
  // Layer A — re-extract through pdfText (same bidi reorder) and check every value is gone, even
  // after separator/bidi normalization and in reversed run order.
  const reExtracted = await extractPdfMapped(bytes.buffer as ArrayBuffer);
  const normText = normalizeForLeak(reExtracted.text);
  const reversed = (s: string): string => [...s].reverse().join("");
  const layerAHits = needles.filter((n) => {
    const nn = normalizeForLeak(n);
    return nn.length > 0 && (normText.includes(nn) || normText.includes(reversed(nn)));
  });
  // Layers B + C — raw-byte scan (incl. inflated streams) and structure check.
  const b = await layerB(bytes, needles);
  const c = layerC(bytes);
  if (layerAHits.length > 0 || !b.pass || !c.pass) {
    throw new Error(
      `PDF redaction self-verify FAILED (layerA=${layerAHits.join(",") || "ok"} ` +
        `layerB=${b.hits.join(",") || "ok"} layerC=eof:${c.eofCount}/sx:${c.startxrefCount})`,
    );
  }
}

/**
 * Redact a PDF by OVERLAYING true-removal redactions on the original, in place. Detection runs on the
 * mapped logical text (via the injected anonymize — deterministic, plus NER names when loaded); each
 * detected span maps to per-line rects from its glyph quads; a Redact annotation over each rect then
 * `applyRedactions` truly removes the text (and covered image pixels). The result is saved with the
 * proven garbage-collecting options and, before it is ever returned, passes the three-layer self-verify
 * — a leak throws instead of handing back a bad file (real detection only, applied to removal).
 */
export async function redactPdf(buffer: ArrayBuffer, anonymize: Anonymize): Promise<RedactedFile> {
  const mupdf: any = await import("mupdf");
  const doc = mupdf.PDFDocument.openDocument(new Uint8Array(buffer), "application/pdf");
  const mapped = mappedFromDoc(doc);
  const result: AnonymizeResult = await anonymize(mapped.text);

  // Detected span → per-line redaction rectangles from the attached glyph quads.
  const rects: RedactRect[] = result.spans.flatMap((span) =>
    refsToRects(quadsForSpan(mapped, span.start, span.end)),
  );

  const PDFPage = mupdf.PDFPage;
  const touchedPages = new Set<number>();
  for (const rect of rects) {
    const page = doc.loadPage(rect.pageIndex);
    const annot = page.createAnnotation("Redact");
    annot.setRect([rect.x0, rect.y0, rect.x1, rect.y1]);
    annot.update();
    touchedPages.add(rect.pageIndex);
  }
  for (const pageIndex of touchedPages) {
    doc
      .loadPage(pageIndex)
      .applyRedactions(
        true,
        PDFPage.REDACT_IMAGE_PIXELS,
        PDFPage.REDACT_LINE_ART_NONE,
        PDFPage.REDACT_TEXT_REMOVE,
      );
  }

  // asUint8Array() is a live view into WASM memory — the self-verify below re-opens mupdf and would
  // clobber it. Copy into a JS-owned buffer immediately.
  const bytes = new Uint8Array(doc.saveToBuffer(SAFE_SAVE_OPTIONS).asUint8Array());
  await selfVerify(bytes, result.key.map((row) => row.original));
  return { bytes, result };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
