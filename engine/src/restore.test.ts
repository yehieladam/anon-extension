/**
 * restore — tolerant token matching + a full end-to-end round-trip through the real pipeline
 * (recognizers -> resolveOverlaps -> anonymize -> restore) proving the "before the AI" loop is
 * byte-exact and client-side.
 */
import { describe, expect, it } from "vitest";
import type { KeyRow, Span } from "./types";
import { restore } from "./restore";
import { anonymize } from "./anonymize";
import { resolveOverlaps } from "./resolve";
import { israeliIdRecognizer } from "./recognizers/israeliId";
import { israeliPhoneRecognizer } from "./recognizers/israeliPhone";
import { emailRecognizer } from "./recognizers/email";

const KEY: KeyRow[] = [
  { placeholder: "[ID_1]", original: "123456709", type: "ISRAELI_ID" },
  { placeholder: "[NAME_1]", original: "ישראל ישראלי", type: "PERSON" },
];

/** A key file saved under the OLD Hebrew-labeled vocab (pre-2026-08-06). The generic
 *  `[label_digits]` matcher must still restore it, so users' saved keys don't break. */
const LEGACY_HEBREW_KEY: KeyRow[] = [
  { placeholder: "[ת״ז_1]", original: "123456709", type: "ISRAELI_ID" },
];

describe("restore — tolerant matching", () => {
  it("restores clean placeholders", () => {
    const result = restore("הלקוח [NAME_1] ת״ז [ID_1]", KEY);
    expect(result.restoredText).toBe("הלקוח ישראל ישראלי ת״ז 123456709");
    expect(result.unmatched).toEqual([]);
  });

  it("backward-compat: an OLD Hebrew-labeled key still restores (any quote variant of the token)", () => {
    // A saved key from before the Latin switch; the AI may echo the token with gershayim, an ASCII
    // quote, or a curly quote. All three normalize to the same key and restore.
    expect(restore("בעל ת״ז [ת״ז_1]", LEGACY_HEBREW_KEY).restoredText).toBe("בעל ת״ז 123456709");
    expect(restore('בעל ת״ז [ת"ז_1]', LEGACY_HEBREW_KEY).restoredText).toBe("בעל ת״ז 123456709");
    expect(restore("בעל ת״ז [ת”ז_1]", LEGACY_HEBREW_KEY).restoredText).toBe("בעל ת״ז 123456709");
  });

  it("tolerates injected spaces and bidi control chars in the token", () => {
    const mangled = "שלום [ ‏NAME_1 ] שלום";
    expect(restore(mangled, KEY).restoredText).toBe("שלום ישראל ישראלי שלום");
  });

  it("reports unmatched placeholder-shaped tokens and leaves them in place", () => {
    const result = restore("ידוע [NAME_1] אך לא [PHONE_9]", KEY);
    expect(result.restoredText).toBe("ידוע ישראל ישראלי אך לא [PHONE_9]");
    expect(result.unmatched).toEqual(["[PHONE_9]"]);
  });

  it("does not treat non-placeholder brackets as tokens", () => {
    const result = restore("ראו סעיף [12] ותוספת [א]", KEY);
    expect(result.restoredText).toBe("ראו סעיף [12] ותוספת [א]");
    expect(result.unmatched).toEqual([]);
  });
});

describe("full round-trip through the real pipeline", () => {
  it("restore(anonymize(detect(text))) === text", () => {
    const text =
      "הלקוח בעל ת״ז 123456709, טלפון 052-1234567, נפגש. דוא״ל: cohen.law@office.co.il";

    const spans: Span[] = [
      ...israeliIdRecognizer.recognize(text),
      ...israeliPhoneRecognizer.recognize(text),
      ...emailRecognizer.recognize(text),
    ];
    const resolved = resolveOverlaps(spans);
    const { anonymizedText, key } = anonymize(text, resolved);

    // The anonymized text carries typed placeholders and none of the raw PII.
    expect(anonymizedText).toContain("[ID_1]");
    expect(anonymizedText).toContain("[PHONE_1]");
    expect(anonymizedText).toContain("[EMAIL_1]");
    expect(anonymizedText).not.toContain("123456709");
    expect(anonymizedText).not.toContain("cohen.law@office.co.il");

    // ...and restore rebuilds the original byte for byte.
    const { restoredText, unmatched } = restore(anonymizedText, key);
    expect(restoredText).toBe(text);
    expect(unmatched).toEqual([]);
  });
});
