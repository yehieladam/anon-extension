/**
 * Scanned-PDF OCR feature flag (Stage 5) — DEFAULT OFF. This is the first OCR capability to touch live
 * client data, so it ships dark: the engine is fully built + self-verifying, but scanned PDFs keep
 * showing the existing "coming later" notice until the flag is turned on. The flag doubles as a
 * kill-switch.
 *
 * Runtime toggle (no rebuild) so it can be dogfooded in production before the global default flips:
 *   - build-time default: VITE_SCAN_OCR=1 (off unless explicitly set)
 *   - per-browser override: localStorage["mechikon.scanOcr"] = "1" (or "0" to force off)
 * The localStorage override wins, so a tester can enable it for themselves in prod without exposing it
 * to anyone else.
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
  return (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SCAN_OCR === "1";
}
