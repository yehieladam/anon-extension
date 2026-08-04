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
import { toReplacements } from "@engine/overlay";
import type { AnonymizeResult } from "@engine/types";
import { layerB, layerC, normalizeForLeak } from "@engine/pdfVerify";
import type { RedactedFile, Anonymize } from "./officeRedact";
import { collectOutlineItems, sanitizeMetadata, type OutlineItem } from "./pdfSanitize";

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

/** Read every metadata channel's text (Info values, outline titles, annotation text) DECODED. */
function readMetadataChannels(doc: any): string {
  const parts: string[] = [];
  const info = doc.getTrailer().get("Info");
  if (info && info.isDictionary && info.isDictionary()) {
    for (const key of ["Author", "Title", "Subject", "Keywords", "Creator", "Producer"]) {
      const value = info.get(key);
      if (value && value.asString) {
        parts.push(value.asString());
      }
    }
  }
  for (const item of collectOutlineItems(doc)) {
    parts.push(item.title);
  }
  const pageCount: number = doc.countPages();
  for (let i = 0; i < pageCount; i += 1) {
    const annots = doc.loadPage(i).getAnnotations?.() ?? [];
    for (const annot of annots) {
      if (annot.getContents) {
        parts.push(annot.getContents());
      }
    }
  }
  return parts.join("\n");
}

/**
 * Re-open the redacted bytes and assert no detected value survives — in the page text (layer A), in the
 * raw bytes/streams (layer B), in the structure (layer C), AND in the metadata channels read DECODED
 * (PDF stores Hebrew strings as hex-ASCII `<FEFF…>`, so a raw-byte scan is blind to them — decoding and
 * reading Info/outlines/annotations is the reliable check there).
 */
async function selfVerify(bytes: Uint8Array, needles: readonly string[]): Promise<void> {
  if (needles.length === 0) {
    return;
  }
  const mupdf: any = await import("mupdf");
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf");
  const bodyText = mappedFromDoc(doc).text;
  const metaText = readMetadataChannels(doc);
  const normBody = normalizeForLeak(bodyText);
  const normMeta = normalizeForLeak(metaText);
  const reversed = (s: string): string => [...s].reverse().join("");
  const present = (haystack: string, needle: string): boolean =>
    haystack.includes(needle) || haystack.includes(reversed(needle));
  const layerAHits = needles.filter((n) => {
    const nn = normalizeForLeak(n);
    return nn.length > 0 && (present(normBody, nn) || present(normMeta, nn));
  });
  // Layers B + C — raw-byte scan (incl. inflated streams) and structure check.
  const b = await layerB(bytes, needles);
  const c = layerC(bytes);
  if (layerAHits.length > 0 || !b.pass || !c.pass) {
    throw new Error(
      `PDF redaction self-verify FAILED (layerA/meta=${layerAHits.join(",") || "ok"} ` +
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

  // UNIFIED detection pass: the body's logical text PLUS every outline (bookmark) title go through ONE
  // anonymize call, so the same name is the SAME placeholder in the body and in a bookmark (and the
  // restore key stays coherent). Body spans become glyph-quad rects; outline spans become string
  // replacements in the titles.
  const outlineItems = collectOutlineItems(doc);
  let combined = mapped.text;
  const titleRanges: { start: number; end: number; item: OutlineItem }[] = [];
  for (const item of outlineItems) {
    combined += "\n";
    const start = combined.length;
    combined += item.title;
    titleRanges.push({ start, end: combined.length, item });
  }

  const result: AnonymizeResult = await anonymize(combined);
  const replacements = toReplacements(combined, result);
  const bodyEnd = mapped.text.length;

  // Body: replacements inside the body → per-line redaction rectangles from the attached glyph quads.
  const rects: RedactRect[] = replacements
    .filter((r) => r.end <= bodyEnd)
    .flatMap((r) => refsToRects(quadsForSpan(mapped, r.start, r.end)));

  // Outlines: rewrite each title with the unified placeholders (same key as the body).
  for (const { start, end, item } of titleRanges) {
    const inTitle = replacements.filter((r) => r.start >= start && r.end <= end);
    if (inTitle.length === 0) {
      continue;
    }
    let rewritten = "";
    let cursor = start;
    for (const r of inTitle) {
      rewritten += combined.slice(cursor, r.start) + r.placeholder;
      cursor = r.end;
    }
    rewritten += combined.slice(cursor, end);
    item.setTitle(rewritten);
  }

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

  // Strip the invisible metadata leak channels (Info, XMP, embedded files, annotation text). Outlines
  // were already anonymized above through the unified key.
  sanitizeMetadata(doc);

  // asUint8Array() is a live view into WASM memory — the self-verify below re-opens mupdf and would
  // clobber it. Copy into a JS-owned buffer immediately.
  const bytes = new Uint8Array(doc.saveToBuffer(SAFE_SAVE_OPTIONS).asUint8Array());
  await selfVerify(bytes, result.key.map((row) => row.original));
  return { bytes, result };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
