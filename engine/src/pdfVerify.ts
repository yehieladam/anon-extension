/**
 * PDF redaction verifier — layers B and C of the three-layer acceptance test (ported from
 * spikes/pdf-01/src/acceptance.mjs). This is the REAL gate: a redaction is only trusted if the PII
 * bytes are genuinely gone from the file, not merely hidden behind a black box. Layer A (re-extract
 * the text and assert the values are absent) needs mupdf and lives with the redactor; layers B and C
 * are pure byte work, so they run both in the worker (production self-verify) and in node (Vitest).
 *
 * Proven facts this encodes (spikes/pdf-01/FINDINGS.md):
 *  - A plain or compress-only save STILL leaves the orphaned content stream in the file; only
 *    `{garbage:"deduplicate", compress:true, sanitize:true}` removes it. Counting `%%EOF` is NOT
 *    sufficient — the raw-byte scan (layer B), including INFLATED stream payloads, is the true check.
 *  - Hebrew is stored/extracted in reversed visual order and split by soft hyphens / bidi controls,
 *    so we scan UTF-8, UTF-16LE and reversed forms after normalizing separators away.
 *  - A PII value never lives inside a font program or image pixels, but those binaries contain bytes
 *    (e.g. a font's "0123456789" table) that false-positive short numeric needles — so we skip
 *    font/image streams.
 *
 * Isomorphic: uses the global `DecompressionStream` (Node 20 + browsers), never node:zlib.
 */

const utf8Encoder = new TextEncoder();

function reverse(text: string): string {
  return [...text].reverse().join("");
}

/** UTF-16LE bytes of a string (per code unit; enough for a byte scan). */
function utf16le(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[i * 2] = code & 0xff;
    bytes[i * 2 + 1] = code >> 8;
  }
  return bytes;
}

/**
 * Strip format/bidi controls and every space/hyphen variant, so "052­1234567" (soft hyphen) and
 * "052-1234567" both collapse to "0521234567" and cannot hide behind a separator.
 */
export function normalizeForLeak(text: string): string {
  return text
    .replace(/[­‎‏‪-‮⁦-⁩]/g, "") // format/bidi controls
    .replace(/[\s‐-―-]/g, ""); // spaces + hyphen/dash variants
}

/** A stream whose payload is a font program or image — skip it (binary false positives). */
function isBinaryAssetStream(dictText: string): boolean {
  return /\/FontFile[23]?\b|\/Length1\b|\/Subtype\s*\/(Image|CIDFontType|Type1C|TrueType)|\/Type\s*\/Font/.test(
    dictText,
  );
}

/** Case-insensitive-free byte substring search. */
function bytesInclude(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false;
  }
  const last = haystack.length - needle.length;
  outer: for (let i = 0; i <= last; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const last = haystack.length - needle.length;
  outer: for (let i = from; i <= last; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

async function inflate(bytes: Uint8Array, format: "deflate" | "deflate-raw"): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Pull every `stream…endstream` payload from the raw bytes and, where it inflates, its decompressed
 * form too — surfacing PII in superseded/compressed objects the xref no longer references. Font and
 * image streams are skipped.
 */
async function decompressedBlobs(buf: Uint8Array): Promise<Uint8Array[]> {
  const blobs: Uint8Array[] = [];
  const streamKw = utf8Encoder.encode("stream");
  const endKw = utf8Encoder.encode("endstream");
  const objKw = utf8Encoder.encode(" obj");
  let pos = 0;
  for (;;) {
    const start = indexOfBytes(buf, streamKw, pos);
    if (start === -1) {
      break;
    }
    const objAt = lastIndexOfBytes(buf, objKw, start);
    const dictStart = objAt === -1 ? Math.max(0, start - 512) : Math.max(objAt, start - 2000);
    const dictText = latin1(buf.subarray(dictStart, start));
    let dataStart = start + streamKw.length;
    if (buf[dataStart] === 0x0d) {
      dataStart += 1;
    }
    if (buf[dataStart] === 0x0a) {
      dataStart += 1;
    }
    const end = indexOfBytes(buf, endKw, dataStart);
    if (end === -1) {
      break;
    }
    if (!isBinaryAssetStream(dictText)) {
      const raw = buf.subarray(dataStart, end);
      blobs.push(raw);
      try {
        blobs.push(await inflate(raw, "deflate"));
      } catch {
        try {
          blobs.push(await inflate(raw, "deflate-raw"));
        } catch {
          /* not a deflate stream; ignore */
        }
      }
    }
    pos = end + endKw.length;
  }
  return blobs;
}

function lastIndexOfBytes(haystack: Uint8Array, needle: Uint8Array, before: number): number {
  for (let i = Math.min(before, haystack.length - needle.length); i >= 0; i -= 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return i;
    }
  }
  return -1;
}

export interface LayerResult {
  readonly pass: boolean;
  readonly hits: readonly string[];
}

/**
 * Layer B — scan the raw file bytes AND every inflated non-asset stream against each needle in UTF-8,
 * UTF-16LE and reversed forms. Any hit means the PII is still physically present.
 */
export async function layerB(bytes: Uint8Array, needles: readonly string[]): Promise<LayerResult> {
  const targets = [bytes, ...(await decompressedBlobs(bytes))];
  const hits: string[] = [];
  for (const needle of needles) {
    const forms: ReadonlyArray<readonly [string, Uint8Array]> = [
      ["utf-8", utf8Encoder.encode(needle)],
      ["utf-16le", utf16le(needle)],
      ["utf-8 (reversed)", utf8Encoder.encode(reverse(needle))],
      ["utf-16le (reversed)", utf16le(reverse(needle))],
    ];
    for (const [form, needleBytes] of forms) {
      if (targets.some((target) => bytesInclude(target, needleBytes))) {
        hits.push(`${needle} [${form}]`);
      }
    }
  }
  return { pass: hits.length === 0, hits };
}

export interface LayerCResult {
  readonly pass: boolean;
  readonly eofCount: number;
  readonly startxrefCount: number;
}

/** Layer C — exactly one `%%EOF` and one `startxref`; more means leftover prior generations. */
export function layerC(bytes: Uint8Array): LayerCResult {
  const count = (marker: string): number => {
    const needle = utf8Encoder.encode(marker);
    let n = 0;
    let idx = indexOfBytes(bytes, needle, 0);
    while (idx !== -1) {
      n += 1;
      idx = indexOfBytes(bytes, needle, idx + needle.length);
    }
    return n;
  };
  const eofCount = count("%%EOF");
  const startxrefCount = count("startxref");
  return { pass: eofCount === 1 && startxrefCount === 1, eofCount, startxrefCount };
}
