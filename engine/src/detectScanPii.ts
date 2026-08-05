/**
 * Scan-mode PII detection (OCR Stage 3) — the SEPARATE entrypoint for the scanned-PDF path. Pure and
 * framework-free (no mupdf/tesseract), consuming OCR words+bboxes rather than glyph quads, so the
 * scan-only relaxations here can NEVER leak into the digital-text path (that path takes quads and never
 * imports this module — structural isolation, not a boolean flag that could be mis-set).
 *
 * It composes THREE detection contributors, all producing image-pixel boxes that union with standard
 * detection (over-coverage is safe by design — defense in depth):
 *   (A) STANDARD — the injected anonymize (NER names + deterministic valid-ID/phone/etc) on the OCR
 *       text; each match's char-range maps back to covering word boxes. Drives the UI/key. A match that
 *       maps to ZERO boxes is a PII we cannot cover → throw SCAN_UNMAPPABLE_PII (whole-file refuse,
 *       never silent-skip).
 *   (B) DIGIT-RUN RELAX — any 8-10 contiguous digits (checksum-optional), page-wide. Catches an
 *       unlabeled ID/phone the OCR misread digit-for-digit. Over-redacts pure-digit dates — accepted,
 *       the safe direction on an unreliable scan.
 *   (C) LABEL-ANCHOR — a PII label (lexicon), matched as a merged token or as a bare label spanning up
 *       to two consecutive words, redacts the label plus its same-line value neighbors content-blind.
 *       This closes the calibration worst case (an all-1s ID that OCR read as Hebrew letters
 *       `פוווווווו`, merged with its `מספרזהות` label into one token — zero digits, so (A)/(B) are blind).
 * (B)+(C) are redaction-only (NO key rows — a misread value has no recoverable original); only (A)
 * yields key rows. See docs/ocr-calibration.md.
 */
import type { AnonymizeResult } from "./types";
import type { OcrBox, OcrPageResult, OcrWord } from "./ocrTypes";
import { buildOcrText, unionRect, wordsForRange } from "./ocrMap";

/** Thrown when a standard (A) detection maps to zero word boxes — a PII we cannot locate to redact. */
export const SCAN_UNMAPPABLE_PII = "SCAN_UNMAPPABLE_PII";

/** Injected detector: standard anonymize over the OCR text (deterministic, plus NER when loaded). */
export type Anonymize = (text: string) => AnonymizeResult | Promise<AnonymizeResult>;

/** Result: image-pixel boxes to redact (one per contiguous run) + the standard result for UI/key. */
export interface ScanDetection {
  readonly boxes: readonly OcrBox[];
  readonly result: AnonymizeResult;
}

// --- (C) label lexicon -------------------------------------------------------------------------------

/** PII labels (Hebrew). Matched space-insensitively so a merged token `מספרזהות…` still hits `מספר זהות`
 * and a two-word split `תעודת` `זהות` rejoins to the compound label. */
const LABELS: readonly string[] = [
  "שם", "שם הלקוח", "שם המבקש", "שם מלא", "שם התובע", "שם הנתבע", // name
  'תעודת זהות', 'ת"ז', "ת.ז", "מספר זהות", "מס' זהות", "מ.ז", // id
  "טלפון", "טל'", "נייד", "פלאפון", "פקס", "מס' טלפון", // phone
];
/** Longest label is two words (`תעודת זהות`, `שם הלקוח`) — bound the consecutive-word rejoin window. */
const LABEL_MAX_WORDS = 2;
/** A value is at most 3 tokens (a name); IDs/phones are one token. Bounds over-redaction. */
const VALUE_MAX_WORDS = 3;
/** Same-field gap: ≤ 1.5× the label's text height (size/DPI-invariant). */
const GAP_FACTOR = 1.5;

/** Strip bidi controls (OCR emits them around RTL runs) so matching is on the letters alone. */
function stripBidi(text: string): string {
  return text.replace(/[‎‏‪-‮⁦-⁩]/g, "");
}
const norm = (text: string): string => stripBidi(text.normalize("NFC")).trim();
const noSpace = (text: string): string => norm(text).replace(/\s+/g, "");
const LABEL_KEYS: readonly string[] = LABELS.map(noSpace);

/** Token starts with a label AND carries extra content → a merged label+value token (the d2 case). */
function isMergedLabelToken(tokenText: string): boolean {
  const t = noSpace(tokenText);
  return LABEL_KEYS.some((key) => t.length > key.length && t.startsWith(key));
}
/** Token (or rejoined run) IS a label, allowing a trailing colon. */
function isLabelExact(text: string): boolean {
  return LABEL_KEYS.includes(noSpace(text).replace(/:$/, ""));
}
/** A word that itself reads like a label — the value chase stops here (next field). */
function looksLikeLabel(text: string): boolean {
  return isLabelExact(text) || isMergedLabelToken(text);
}

// --- geometry helpers (image-pixel space) ------------------------------------------------------------

const boxHeight = (b: OcrBox): number => b.y1 - b.y0;
/** Same text line: vertical overlap covers at least half the shorter box. */
function sameLine(a: OcrBox, b: OcrBox): boolean {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return overlap > 0.5 * Math.min(boxHeight(a), boxHeight(b));
}
/** Horizontal edge-to-edge gap (0 if the boxes overlap in x). */
function horizontalGap(a: OcrBox, b: OcrBox): number {
  return Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
}

const nonEmpty = (word: OcrWord | undefined): boolean => !!word && word.text.trim().length > 0;

/** Are the given consecutive word indices one same-line, gap-close run (part of one label phrase)? */
function contiguousRun(indices: readonly number[], words: readonly OcrWord[]): boolean {
  for (let k = 1; k < indices.length; k += 1) {
    const a = words[indices[k - 1]].bbox;
    const b = words[indices[k]].bbox;
    if (!sameLine(a, b) || horizontalGap(a, b) > GAP_FACTOR * Math.max(boxHeight(a), boxHeight(b))) {
      return false;
    }
  }
  return true;
}

/** Same-line value words next to a label box: chase outward on each side while the gap stays within
 * 1.5x the label height and the word is not itself a label, capped at VALUE_MAX_WORDS total. */
function valueNeighbors(labelBox: OcrBox, labelSet: ReadonlySet<number>, words: readonly OcrWord[]): number[] {
  const gapMax = GAP_FACTOR * boxHeight(labelBox);
  const candidates = words
    .map((word, index) => ({ word, index }))
    .filter(({ word, index }) => !labelSet.has(index) && nonEmpty(word) && sameLine(labelBox, word.bbox));
  const left = candidates.filter((c) => c.word.bbox.x1 <= labelBox.x0).sort((a, b) => b.word.bbox.x1 - a.word.bbox.x1);
  const right = candidates.filter((c) => c.word.bbox.x0 >= labelBox.x1).sort((a, b) => a.word.bbox.x0 - b.word.bbox.x0);
  const picked: number[] = [];
  const chase = (chain: { word: OcrWord; index: number }[]): void => {
    let prev = labelBox;
    for (const { word, index } of chain) {
      if (picked.length >= VALUE_MAX_WORDS || looksLikeLabel(word.text) || horizontalGap(prev, word.bbox) > gapMax) {
        return;
      }
      picked.push(index);
      prev = word.bbox;
    }
  };
  chase(right);
  chase(left);
  return picked;
}

/** Union the given word boxes into one covering box (throws on empty via unionRect — never a no-op). */
function coverWords(indices: readonly number[], words: readonly OcrWord[]): OcrBox {
  return unionRect(indices.map((i) => words[i].bbox));
}

/**
 * (C) Label-anchored boxes: a merged label+value token, or a bare label (1-2 consecutive close words)
 * plus its same-line value neighbors. Exported so the redaction path can be exercised in isolation
 * (proving label-anchor's bbox actually removes real pixels, independent of the digit detectors).
 */
export function labelAnchorBoxes(words: readonly OcrWord[]): OcrBox[] {
  const boxes: OcrBox[] = [];
  for (let i = 0; i < words.length; i += 1) {
    if (!nonEmpty(words[i])) continue;
    if (isMergedLabelToken(words[i].text)) {
      boxes.push(words[i].bbox); // whole merged token (label + stuck value)
      continue;
    }
    // Bare label spanning up to two consecutive close words → label + value neighbors.
    for (let span = Math.min(LABEL_MAX_WORDS, words.length - i); span >= 1; span -= 1) {
      const indices = Array.from({ length: span }, (_, k) => i + k);
      if (!indices.every((j) => nonEmpty(words[j])) || !contiguousRun(indices, words)) continue;
      const joined = indices.map((j) => words[j].text).join(" ");
      if (!isLabelExact(joined)) continue;
      const labelBox = coverWords(indices, words);
      const value = valueNeighbors(labelBox, new Set(indices), words);
      boxes.push(coverWords([...indices, ...value], words));
      i += span - 1;
      break;
    }
  }
  return boxes;
}

// --- (B) unlabeled digit-run relax -------------------------------------------------------------------

/** 8-10 digits with optional single space/hyphen/dot separators, not touching more digits or a slash
 * (a slash means a date like 01/01/2024, out of scope). Absorbs a ±1-digit OCR misread of a 9-digit ID
 * or a 10-digit phone; excludes 7-digit amounts and 4-5-digit docket numbers. */
const DIGIT_RUN = /(?<![\d/])\d(?:[\s.-]?\d){7,9}(?![\d/])/g;

// --- assembly ----------------------------------------------------------------------------------------

/**
 * Detect PII on an OCR page and return the image-pixel boxes to redact plus the standard result. The
 * three contributors are unioned; standard (A) matches with zero coverage throw SCAN_UNMAPPABLE_PII.
 */
export async function detectScanPii(page: OcrPageResult, anonymize: Anonymize): Promise<ScanDetection> {
  const words = page.words;
  const { text, ranges } = buildOcrText(words);
  const result = await anonymize(text);
  const boxes: OcrBox[] = [];

  // (A) standard detections → covering boxes; zero coverage is a hard refusal, never a skip.
  for (const span of result.spans) {
    const indices = wordsForRange(ranges, span.start, span.end);
    if (indices.length === 0) {
      throw new Error(SCAN_UNMAPPABLE_PII);
    }
    boxes.push(coverWords(indices, words));
  }

  // (B) unlabeled digit-run relax (page-wide, checksum-optional).
  for (const match of text.matchAll(DIGIT_RUN)) {
    const indices = wordsForRange(ranges, match.index, match.index + match[0].length);
    if (indices.length > 0) {
      boxes.push(coverWords(indices, words));
    }
  }

  // (C) label-anchor.
  boxes.push(...labelAnchorBoxes(words));

  return { boxes, result };
}
