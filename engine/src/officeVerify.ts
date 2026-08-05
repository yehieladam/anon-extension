/**
 * Office self-verify — the office analogue of pdfVerify's layer scan, and the load-bearing guarantee
 * for docx/xlsx redaction: after redaction, NO original PII value may survive in ANY text part of the
 * output zip, including parts the redactor never rewrote (docProps metadata, comments, settings…).
 * Framework-free and JSZip-free: the caller hands us the already-decompressed parts, so this stays a
 * pure, node-testable function that mirrors engine/pdfVerify.
 *
 * Office XML is always UTF-8, and JSZip gives us decompressed text — so, unlike the PDF raw-byte scan,
 * there is no stream inflation and no UTF-16/hex-string decoding to do. We only decode XML entities
 * (a name written `Cohen &amp; Levi` must still be caught) and normalize away separators/bidi controls.
 */
import { decodeXml } from "./xml";
import { normalizeForLeak } from "./pdfVerify";

export interface OfficeLeakResult {
  readonly pass: boolean;
  /** `"<path>: <needle>"` for each surviving value — a debuggable throw message. */
  readonly hits: readonly string[];
}

/** Only text-bearing OOXML parts are scanned; media/fonts/printer blobs would false-positive on digits. */
function isTextPart(path: string): boolean {
  return /\.(xml|rels)$/i.test(path);
}

/**
 * Scan every text part for any needle (the redaction key's original values). A part is decoded
 * (XML entities) and normalized the same way needles are, so escaped/separated forms still match.
 */
export function officeLeakScan(
  parts: ReadonlyMap<string, string>,
  needles: readonly string[],
): OfficeLeakResult {
  const probes = needles
    .map((original) => ({ original, normalized: normalizeForLeak(original) }))
    .filter((probe) => probe.normalized.length > 0);
  if (probes.length === 0) {
    return { pass: true, hits: [] };
  }

  const hits: string[] = [];
  for (const [path, content] of parts) {
    if (!isTextPart(path)) {
      continue;
    }
    const haystack = normalizeForLeak(decodeXml(content));
    for (const probe of probes) {
      if (haystack.includes(probe.normalized)) {
        hits.push(`${path}: ${probe.original}`);
      }
    }
  }
  return { pass: hits.length === 0, hits };
}
