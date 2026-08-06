/**
 * Scanned-PDF OCR feature flag — DEFAULT ON since 2026-08-06. Turned on after the whole track shipped
 * (Stages 0-6: gate, coordinate map, redaction + 3 content mechanisms, fixed-point self-verify,
 * AI-usable tokenized output + restore) and an end-to-end browser test against production passed (real
 * scan -> tokenized "Word for AI" with no raw PII -> download; the tesseract blob-worker path bug fixed
 * in #83). The flag remains as a KILL-SWITCH:
 *   - global off: set VITE_SCAN_OCR="0" (or revert this default), redeploy.
 *   - per-browser off: localStorage["mechikon.scanOcr"] = "0" (or "1" to force on).
 */
const STORAGE_KEY = "mechikon.scanOcr";

export function isScanOcrEnabled(): boolean {
  try {
    const override = localStorage.getItem(STORAGE_KEY);
    if (override === "1") return true;
    if (override === "0") return false;
  } catch {
    // localStorage can throw in privacy modes — fall through to the build-time default.
  }
  // Default ON; the global kill-switch is VITE_SCAN_OCR="0".
  return (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SCAN_OCR !== "0";
}
