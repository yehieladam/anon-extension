/**
 * IL_LAND — גוש/חלקה, anchored on both keywords. Fires only when both keywords have numbers;
 * ignores keyword-only phrases (גוש עציון) and a lone חלקה.
 */
import { describe, expect, it } from "vitest";
import { israeliLandRecognizer } from "./israeliLand";

describe("israeliLandRecognizer", () => {
  it.each([
    "גוש 6941 חלקה 23",
    "גוש: 6941, חלקה: 23",
    "גוש 30150 חלקה 45/2",
  ])("detects %s as one span", (parcel) => {
    const spans = israeliLandRecognizer.recognize(parcel);
    expect(spans).toHaveLength(1);
    expect(parcel.slice(spans[0].start, spans[0].end)).toBe(parcel);
    expect(spans[0].type).toBe("IL_LAND");
  });

  it("finds a parcel inside a Hebrew sentence with correct offsets", () => {
    const text = "הנכס רשום בגוש 6941 חלקה 23 בלשכת רישום המקרקעין";
    const spans = israeliLandRecognizer.recognize(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("גוש 6941 חלקה 23");
  });

  it("ignores keyword-only phrases with no numbers", () => {
    expect(israeliLandRecognizer.recognize("גוש עציון")).toHaveLength(0);
    expect(israeliLandRecognizer.recognize("גוש דן הוא אזור")).toHaveLength(0);
  });

  it("does not fire on a lone חלקה without a preceding גוש", () => {
    expect(israeliLandRecognizer.recognize("חלקה 23 בלבד")).toHaveLength(0);
  });
});
