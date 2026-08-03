// Redaction core: find PII quads via search(), drop a Redact annotation over
// each, then applyRedactions with true text + image-pixel removal.
import * as mupdf from 'mupdf';

const PDFPage = mupdf.PDFPage;

// Convert an 8-number quad (ul,ur,ll,lr) to an [x0,y0,x1,y1] rect.
function quadToRect(q) {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function reverse(s) {
  return [...s].reverse().join('');
}

// mupdf reorders RTL runs on extraction, an ASCII hyphen can round-trip through
// the generated ToUnicode as U+00AD, AND search() treats U+00AD as a break so a
// hyphenated value is only findable as split tokens. To LOCATE a planted PII
// string we try several stored representations plus its hyphen-split parts.
function searchVariants(needle) {
  const soft = needle.replaceAll('-', '­');
  const variants = [needle, reverse(needle), soft, reverse(soft)];
  if (needle.includes('-')) {
    // Add each hyphen-separated part (redacts both halves of e.g. a phone).
    for (const part of needle.split('-')) {
      if (part.length >= 2) variants.push(part, reverse(part));
    }
  }
  return variants;
}

// Add redaction annotations for every hit of every needle on every page.
// Returns { boxes, matched } where matched maps needle -> variant that hit.
export function markRedactions(doc, needles) {
  let boxes = 0;
  const matched = {};
  const nPages = doc.countPages();
  for (let i = 0; i < nPages; i++) {
    const page = doc.loadPage(i);
    for (const needle of needles) {
      const hitVariants = [];
      for (const variant of searchVariants(needle)) {
        const hits = page.search(variant, 200);
        if (hits.length === 0) continue;
        hitVariants.push(variant);
        for (const hit of hits) {
          for (const quad of hit) {
            const annot = page.createAnnotation('Redact');
            annot.setRect(quadToRect(quad));
            boxes++;
          }
        }
      }
      if (hitVariants.length > 0) matched[needle] = hitVariants;
    }
  }
  return { boxes, matched };
}

// Apply all pending redactions on every page with TRUE removal:
// black_boxes=true, image_method=REDACT_IMAGE_PIXELS, text_method=REDACT_TEXT_REMOVE.
export function applyAll(doc) {
  const nPages = doc.countPages();
  for (let i = 0; i < nPages; i++) {
    const page = doc.loadPage(i);
    page.applyRedactions(
      true,
      PDFPage.REDACT_IMAGE_PIXELS,
      PDFPage.REDACT_LINE_ART_NONE,
      PDFPage.REDACT_TEXT_REMOVE
    );
  }
}

// The two save strategies we compare.
// LEAKY: incremental append keeps the pre-redaction objects recoverable.
export function saveIncremental(doc) {
  return doc.saveToBuffer({ incremental: true }).asUint8Array();
}

// SAFE: full rewrite + garbage collection => old object generations dropped.
export const SAFE_SAVE_OPTIONS = { garbage: 'compact', compress: true, sanitize: true };
export function saveFullRewrite(doc) {
  return doc.saveToBuffer(SAFE_SAVE_OPTIONS).asUint8Array();
}
