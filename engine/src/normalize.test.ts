/**
 * B1 + L2 (security audit 2026-08-07): invisible bidi/format marks copied from Word/PDF/web sit INSIDE
 * digit runs and silently defeat ID/phone detection ("found 0", user ships the PII), and non-ASCII
 * digit variants (fullwidth, Arabic-Indic) are never folded. Detection must normalize on a shadow copy
 * with an offset map, so spans still map back to the EXACT original characters (which get redacted).
 */
import { describe, expect, it } from "vitest";
import { detectDeterministic, anonymizeDeterministic } from "./pipeline";
import { restore } from "./restore";
import { normalizeForDetection } from "./normalize";

const RLM = "‏"; // right-to-left mark
const SOFT_HYPHEN = "­";
const ZWSP = "​";

describe("B1 — invisible bidi/format chars must not defeat detection", () => {
  it("detects a mobile phone split by an embedded RLM", () => {
    const spans = detectDeterministic(`טל ${"052" + RLM + "1234567"}`);
    expect(spans.some((s) => s.type === "IL_PHONE")).toBe(true);
  });

  it("detects an Israeli ID split by an embedded RLM", () => {
    // "0612<RLM>34506" -> "061234506", a checksum-valid ID.
    const spans = detectDeterministic(`ת"ז ${"0612" + RLM + "34506"}`);
    expect(spans.some((s) => s.type === "ISRAELI_ID")).toBe(true);
  });

  it("detects a mobile phone split by a soft hyphen", () => {
    const spans = detectDeterministic(`טל ${"05" + SOFT_HYPHEN + "21234567"}`);
    expect(spans.some((s) => s.type === "IL_PHONE")).toBe(true);
  });

  it("detects a phone split by a zero-width space", () => {
    const spans = detectDeterministic(`נייד ${"054" + ZWSP + "1234567"}`);
    expect(spans.some((s) => s.type === "IL_PHONE")).toBe(true);
  });
});

describe("L2 — non-ASCII digit variants are folded before detection", () => {
  it("detects a phone written in fullwidth digits", () => {
    const fullwidth = "0521234567".replace(/\d/g, (d) => String.fromCodePoint(0xff10 + Number(d)));
    expect(detectDeterministic(fullwidth).some((s) => s.type === "IL_PHONE")).toBe(true);
  });

  it("detects a phone written in Arabic-Indic digits", () => {
    const arabic = "0521234567".replace(/\d/g, (d) => String.fromCodePoint(0x0660 + Number(d)));
    expect(detectDeterministic(arabic).some((s) => s.type === "IL_PHONE")).toBe(true);
  });
});

describe("B1 — offset mapping redacts the exact original characters", () => {
  it("replaces the whole RLM-laced phone and restores it byte-exact", () => {
    const text = `טל ${"052" + RLM + "1234567"} בבוקר`;
    const result = anonymizeDeterministic(text);
    expect(result.anonymizedText).toContain("[PHONE_1]");
    expect(result.anonymizedText).not.toContain("1234567"); // no digit tail leaks past the token
    expect(result.key[0].original).toBe("052" + RLM + "1234567"); // exact surface, incl. the RLM
    expect(restore(result.anonymizedText, result.key).restoredText).toBe(text);
  });
});

describe("normalizeForDetection — shadow + offset map", () => {
  it("strips invisibles and folds digits, mapping each shadow char to its origin", () => {
    const { shadow, map } = normalizeForDetection("052" + RLM + "12");
    expect(shadow).toBe("05212");
    // original indices: 0,1,2 then RLM at 3 (stripped), then 4,5
    expect(map).toEqual([0, 1, 2, 4, 5]);
  });

  it("is identity (fast path) for clean ASCII/Hebrew text", () => {
    const text = 'ת"ז 123456709';
    expect(normalizeForDetection(text).shadow).toBe(text);
  });
});
