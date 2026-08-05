/**
 * Scan refusal mapping (Stage 5) — the one piece of genuinely-new wiring in the App scan flow: turn a
 * worker error message into the two-tier user notice. Pure + unit-tested so a regression in the mapping
 * is caught model-free, even though the notice RENDER is covered by the manual pre-flip walk-through.
 *
 *   SCAN_LOW_CONFIDENCE                        -> "lowQuality" (common, expected: re-scan higher-res)
 *   SCAN_UNMAPPABLE_PII | SCAN_SELFVERIFY_FAILED -> "unsafe"   (rare internal-safety refusals, shared copy)
 *   anything else                              -> null        (a generic error → the generic fileError)
 */
export type ScanNoticeKind = "lowQuality" | "unsafe";

export function scanNoticeFor(message: string): ScanNoticeKind | null {
  if (message.includes("SCAN_LOW_CONFIDENCE")) {
    return "lowQuality";
  }
  if (message.includes("SCAN_UNMAPPABLE_PII") || message.includes("SCAN_SELFVERIFY_FAILED")) {
    return "unsafe";
  }
  return null;
}
