// THREE-LAYER acceptance test, run against a redacted output file's bytes.
// Layer A: re-extract structured text -> planted PII must be ABSENT.
// Layer B: raw-byte scan (UTF-8, UTF-16LE, reversed/visual-order) -> ABSENT.
// Layer C: structure check -> exactly one %%EOF, no leftover prior generations.
import * as mupdf from 'mupdf';
import zlib from 'node:zlib';
import { extractAllText } from './extract.mjs';

function reverse(s) {
  return [...s].reverse().join('');
}

// Pull every `stream ... endstream` payload out of the RAW file bytes and,
// where it is a zlib/Flate stream, return the INFLATED bytes too. This
// surfaces PII sitting in superseded (incremental-leftover) COMPRESSED
// objects that the xref no longer references but that still live in the file.
// A PII string is never stored inside a font program or an image's pixel data,
// but those binaries contain arbitrary bytes (e.g. a font's "0123456789" table)
// that false-positive against short numeric needles. Skip such streams.
function isBinaryAssetStream(dictText) {
  return /\/FontFile[23]?\b|\/Length1\b|\/Subtype\s*\/(Image|CIDFontType|Type1C|TrueType)|\/Type\s*\/Font/.test(
    dictText
  );
}

function decompressedBlobs(buf) {
  const blobs = [];
  const streamKw = Buffer.from('stream');
  const endKw = Buffer.from('endstream');
  let pos = 0;
  while (true) {
    const s = buf.indexOf(streamKw, pos);
    if (s === -1) break;
    // Inspect ONLY the current object's dictionary: from its opening `obj`
    // keyword up to `stream` (bounded so a preceding object cannot bleed in).
    const objKw = buf.lastIndexOf(Buffer.from(' obj'), s);
    const dictStart = objKw === -1 ? Math.max(0, s - 512) : Math.max(objKw, s - 2000);
    const dictText = buf.subarray(dictStart, s).toString('latin1');
    // Skip the CR?LF after the `stream` keyword.
    let dataStart = s + streamKw.length;
    if (buf[dataStart] === 0x0d) dataStart++;
    if (buf[dataStart] === 0x0a) dataStart++;
    const e = buf.indexOf(endKw, dataStart);
    if (e === -1) break;
    if (!isBinaryAssetStream(dictText)) {
      const raw = buf.subarray(dataStart, e);
      blobs.push(raw); // raw payload (uncompressed streams scanned as-is)
      try {
        blobs.push(zlib.inflateSync(raw)); // Flate/zlib
      } catch {
        try {
          blobs.push(zlib.inflateRawSync(raw)); // raw deflate fallback
        } catch {
          /* not a deflate stream; ignore */
        }
      }
    }
    pos = e + endKw.length;
  }
  return blobs;
}

// Encode a string as raw bytes in a given form for the byte scan.
function encodings(s) {
  return {
    'utf-8': Buffer.from(s, 'utf8'),
    'utf-16le': Buffer.from(s, 'utf16le'),
    'utf-8 (reversed)': Buffer.from(reverse(s), 'utf8'),
    'utf-16le (reversed)': Buffer.from(reverse(s), 'utf16le'),
  };
}

// Normalize text so a residual value cannot hide behind separators, bidi
// controls, a soft hyphen, or reversed run order. Strips format/bidi chars and
// all spacing/hyphen separators, so "052­1234567" and "052-1234567" both
// collapse to "0521234567".
function normalizeForLeak(s) {
  return s
    .replace(/[­‎‏‪-‮⁦-⁩]/g, '') // format/bidi
    .replace(/[\s\-‐-―]/g, ''); // spaces + hyphen/dash variants
}

// Layer A: re-extract structured text; assert no planted value survives, even
// after separator/bidi normalization and in reversed run order.
export function layerA(bytes, needles) {
  const doc = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  const text = extractAllText(doc);
  const normText = normalizeForLeak(text);
  const found = [];
  for (const n of needles) {
    const nn = normalizeForLeak(n);
    if (nn.length === 0) continue;
    if (normText.includes(nn) || normText.includes(reverse(nn))) found.push(n);
  }
  return { pass: found.length === 0, found, extracted: text };
}

// Layer B: scan (1) the raw file bytes and (2) every inflated stream payload,
// each against UTF-8 / UTF-16LE / reversed forms.
export function layerB(bytes, needles) {
  const buf = Buffer.from(bytes);
  const targets = [buf, ...decompressedBlobs(buf)];
  const hits = [];
  for (const n of needles) {
    for (const [form, needleBytes] of Object.entries(encodings(n))) {
      const where = targets.some((t) => t.includes(needleBytes));
      if (where) hits.push(`${n} [${form}]`);
    }
  }
  return { pass: hits.length === 0, hits };
}

// Layer C
export function layerC(bytes) {
  const buf = Buffer.from(bytes);
  // Count %%EOF markers.
  const eofMarker = Buffer.from('%%EOF');
  let eofCount = 0;
  let idx = buf.indexOf(eofMarker, 0);
  while (idx !== -1) {
    eofCount++;
    idx = buf.indexOf(eofMarker, idx + eofMarker.length);
  }
  // Count "startxref" (each incremental update adds one).
  const sxMarker = Buffer.from('startxref');
  let sxCount = 0;
  let sidx = buf.indexOf(sxMarker, 0);
  while (sidx !== -1) {
    sxCount++;
    sidx = buf.indexOf(sxMarker, sidx + sxMarker.length);
  }
  return {
    pass: eofCount === 1 && sxCount === 1,
    eofCount,
    startxrefCount: sxCount,
  };
}

// textNeedles: full + stored variants asserted absent from re-extracted TEXT.
// byteNeedles: full-length planted values only (short fragments would
//   false-positive in binary), scanned across raw + decompressed non-asset
//   streams in UTF-8 / UTF-16LE / reversed forms.
export function runThreeLayer(bytes, textNeedles, byteNeedles = textNeedles) {
  const a = layerA(bytes, textNeedles);
  const b = layerB(bytes, byteNeedles);
  const c = layerC(bytes);
  return { pass: a.pass && b.pass && c.pass, a, b, c };
}
