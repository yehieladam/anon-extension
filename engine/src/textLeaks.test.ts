/**
 * Layer-A text leak-scan (the H1 fix) — the safety-critical tests. Proves the whole-word/digit-bounded
 * check eliminates the substring FALSE POSITIVE (a redacted short name appearing inside a longer legit
 * word threw away correctly-redacted files) WITHOUT weakening real-leak detection.
 */
import { describe, expect, it } from "vitest";
import { textLeaks } from "./pdfVerify";

describe("textLeaks — H1 fix (whole-word names, digit-bounded numbers)", () => {
  it("1. REGRESSION: a redacted name that only survives as a SUBSTRING of a legit word is NOT a leak", () => {
    // "כהן" was redacted at its whole-word occurrence; only "מכהן"/"הכהן" (legit words) remain.
    const body = "התובע [שם_1] מכהן בתפקיד הכהן הגדול בבית המשפט";
    expect(textLeaks(body, "", ["כהן"])).toEqual([]);
  });

  it("2. a REAL whole-word survivor IS still a leak (detection intact)", () => {
    const body = "התובע כהן הגיש תביעה"; // the name survives as a whole word
    expect(textLeaks(body, "", ["כהן"])).toEqual(["כהן"]);
  });

  it("3. multi-name doc: several short names as substrings of legit words → no false positive", () => {
    const body = "הלוי מכהן דודה כהנא הכהן"; // לוי in הלוי, כהן in מכהן/הכהן, דוד in דודה — all substrings
    expect(textLeaks(body, "", ["לוי", "כהן", "דוד"])).toEqual([]);
  });

  it("4. a numeric value split by a separator IS caught (separator-robust)", () => {
    const body = "טלפון: 052-1234567 ליצירת קשר";
    expect(textLeaks(body, "", ["0521234567"])).toEqual(["0521234567"]);
  });

  it("5. a numeric value INSIDE a longer number is NOT a leak (digit-bounded)", () => {
    const body = "מספר חשבונית 3847205 בסך"; // 384720 is a prefix of the 7-digit 3847205
    expect(textLeaks(body, "", ["384720"])).toEqual([]);
  });

  it("6. reversed Hebrew (mupdf visual order) still catches a real name survivor", () => {
    const body = "ןהכ הגיש"; // "כהן" reversed, as a whole word
    expect(textLeaks(body, "", ["כהן"])).toEqual(["כהן"]);
  });

  it("7. a leak in the METADATA channel is caught", () => {
    expect(textLeaks("clean body", "author: כהן", ["כהן"])).toEqual(["כהן"]);
  });

  it("8. tokenization-adjacency: a needle glued to a placeholder bracket is NOT a leak", () => {
    // "…טל03-6489210…" -> the phone tokenizes to "[טלפון_4]", leaving "טל[טלפון_4]". "טל" was never a
    // whole word in the original (glued to the digit "0"); only the token forges a boundary. The AI-text
    // verify neutralizes brackets ("[" / "]" -> word char) before scanning, so this is not flagged.
    const aiText = "מר [שם_2] טל[טלפון_4]".replace(/[[\]]/g, "x");
    expect(textLeaks(aiText, "", ["טל"])).toEqual([]);
  });

  it("9. a real name separated from a token by a space IS still a leak (neutralization is narrow)", () => {
    const aiText = "[שם_1] טל הגיש".replace(/[[\]]/g, "x");
    expect(textLeaks(aiText, "", ["טל"])).toEqual(["טל"]);
  });
});
