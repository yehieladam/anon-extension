/**
 * Detection-time normalization (security audit 2026-08-07, B1 + L2). Hebrew copied from Word/PDF/web
 * carries invisible bidi/format marks (RLM/LRM, soft hyphen, ZWSP/ZWNJ/ZWJ, the bidi embeddings and
 * isolates, the BOM) INSIDE digit runs, which silently defeat ID/phone/IBAN detection; and numbers are
 * sometimes written in fullwidth or Arabic-Indic digits the recognizers never see as digits.
 *
 * We build a SHADOW copy of the text with those marks stripped, digit variants folded to ASCII, and
 * per-character NFC applied, while keeping an offset map back to the ORIGINAL string. Recognizers run on
 * the shadow (so the value is found), and their spans map back to the EXACT original characters — the
 * text the user sees and that gets tokenized/redacted is never mutated (the invisible chars inside a
 * detected value are simply included in the redacted span).
 */

/** A normalized shadow of the text plus the offset map back to the original. */
export interface DetectionShadow {
  readonly shadow: string;
  /** map[k] = original UTF-16 index that shadow[k] came from; map.length === shadow.length. */
  readonly map: readonly number[];
}

/** Invisible/format marks that appear inside copied Hebrew and defeat detection: soft hyphen (00AD),
 *  ZWSP/ZWNJ/ZWJ + LRM/RLM (200B-200F), the bidi embeddings/overrides (202A-202E), the directional
 *  isolates (2066-2069), and the BOM / ZWNBSP (FEFF). Built from an escaped string so the source file
 *  carries no irregular whitespace of its own. */
const INVISIBLE = new RegExp("[\\u00AD\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]");

/** Fold a single fullwidth (FF10-FF19), Arabic-Indic (0660-0669) or Extended Arabic-Indic (06F0-06F9)
 *  digit to its ASCII value; null for anything else. */
function foldDigit(ch: string): string | null {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0xff10 && cp <= 0xff19) return String(cp - 0xff10);
  if (cp >= 0x0660 && cp <= 0x0669) return String(cp - 0x0660);
  if (cp >= 0x06f0 && cp <= 0x06f9) return String(cp - 0x06f0);
  return null;
}

/** Build the detection shadow + offset map. Per-character so the map stays exact (invisible chars drop,
 *  every emitted shadow char records the original index it came from). */
export function normalizeForDetection(text: string): DetectionShadow {
  let shadow = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (INVISIBLE.test(ch)) {
      continue; // stripped: contributes nothing to the shadow, so nothing maps to it
    }
    const normalized = foldDigit(ch) ?? ch.normalize("NFC");
    for (let j = 0; j < normalized.length; j += 1) {
      shadow += normalized[j];
      map.push(i);
    }
  }
  return { shadow, map };
}

/**
 * Map a [shadowStart, shadowEnd) span back to original offsets. Covers exactly the original characters
 * the shadow span came from — through the last matched char (never trailing stripped invisibles).
 */
export function mapShadowSpan(
  map: readonly number[],
  shadowStart: number,
  shadowEnd: number,
  originalLength: number,
): { start: number; end: number } {
  const start = map[shadowStart] ?? originalLength;
  const end = shadowEnd > shadowStart ? map[shadowEnd - 1] + 1 : start;
  return { start, end };
}
