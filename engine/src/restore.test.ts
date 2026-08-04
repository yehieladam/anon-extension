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
  { placeholder: "[ת״ז_1]", original: "123456709", type: "ISRAELI_ID" },
  { placeholder: "[שם_1]", original: "ישראל ישראלי", type: "PERSON" },
];

describe("restore — tolerant matching", () => {
  it("restores clean placeholders", () => {
    const result = restore("הלקוח [שם_1] ת״ז [ת״ז_1]", KEY);
    expect(result.restoredText).toBe("הלקוח ישראל ישראלי ת״ז 123456709");
    expect(result.unmatched).toEqual([]);
  });

  it("restores a placeholder whose gershayim was smart-quoted by an LLM", () => {
    // AI returned [ת"ז_1] (ASCII quote) and [ת”ז_1] (curly) instead of the gershayim.
    const result = restore('נא לפנות אל בעל ת״ז [ת"ז_1] ו[ת”ז_1]', KEY);
    expect(result.restoredText).toBe("נא לפנות אל בעל ת״ז 123456709 ו123456709");
    expect(result.unmatched).toEqual([]);
  });

  it("tolerates injected spaces and bidi control chars in the token", () => {
    const mangled = "שלום [ ‏שם_1 ] שלום";
    expect(restore(mangled, KEY).restoredText).toBe("שלום ישראל ישראלי שלום");
  });

  it("reports unmatched placeholder-shaped tokens and leaves them in place", () => {
    const result = restore("ידוע [שם_1] אך לא [טלפון_9]", KEY);
    expect(result.restoredText).toBe("ידוע ישראל ישראלי אך לא [טלפון_9]");
    expect(result.unmatched).toEqual(["[טלפון_9]"]);
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
    expect(anonymizedText).toContain("[ת״ז_1]");
    expect(anonymizedText).toContain("[טלפון_1]");
    expect(anonymizedText).toContain("[אימייל_1]");
    expect(anonymizedText).not.toContain("123456709");
    expect(anonymizedText).not.toContain("cohen.law@office.co.il");

    // ...and restore rebuilds the original byte for byte.
    const { restoredText, unmatched } = restore(anonymizedText, key);
    expect(restoredText).toBe(text);
    expect(unmatched).toEqual([]);
  });
});
