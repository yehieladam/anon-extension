/**
 * Scan restore-key fidelity + text leak-scan (OCR Stage 6) — pure, framework-free.
 *
 * On the scan path the key's `original` values come from OCR, not exact text, so each row is marked with
 * its fidelity so the UI (and the user) can trust high-fidelity rows and verify the rest — never a silent
 * wrong restore. And the tokenized "Word for AI" text is leak-scanned for any surviving VALIDATED
 * original (a tokenization bug backstop; B/C originals are OCR-lossy so they are scanned best-effort).
 */
import type { KeyRow } from "./types";
import { isValidIsraeliId } from "./recognizers/israeliId";
import { isValidIsraeliPhone } from "./recognizers/israeliPhone";

/** Fidelity of a scan key row's `original` (see KeyRow.source). */
function sourceFor(row: KeyRow): NonNullable<KeyRow["source"]> {
  switch (row.type) {
    case "PERSON":
    case "ORGANIZATION":
    case "LOCATION":
      return "ocr"; // NER on OCR text — OCR-quality, restorable
    case "IL_NUMBER":
      return "ocr"; // generic digit run (B) — the OCR-read number round-trips
    case "ISRAELI_ID":
      return isValidIsraeliId(row.original) ? "validated" : /\d/.test(row.original) ? "ocr" : "unreadable";
    case "IL_PHONE":
      return isValidIsraeliPhone(row.original) ? "validated" : /\d/.test(row.original) ? "ocr" : "unreadable";
    default:
      return "validated"; // other deterministic A types (email/IBAN/company/…) are pattern-validated
  }
}

/** Annotate each scan key row with its fidelity marker. */
export function markScanKeySources(key: readonly KeyRow[]): KeyRow[] {
  return key.map((row) => ({ ...row, source: sourceFor(row) }));
}

/** Minimum original length worth leak-scanning (short/common strings false-positive). */
const MIN_LEAK_LEN = 4;

/**
 * Return any VALIDATED original (the faithful needles) that still appears in the tokenized text — a
 * tokenization bug. By construction the spans were replaced, so this should be empty; it is the backstop.
 * B/C ("ocr"/"unreadable") originals are OCR-lossy and NOT asserted (same limitation as the pixel verify).
 */
export function scanTextLeaks(anonymizedText: string, key: readonly KeyRow[]): string[] {
  return key
    .filter((row) => row.source === "validated" && row.original.length >= MIN_LEAK_LEN)
    .map((row) => row.original)
    .filter((original) => anonymizedText.includes(original));
}
