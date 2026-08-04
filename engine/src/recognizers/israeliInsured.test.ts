/**
 * IL_INSURED — number introduced by מבוטח (keyword-anchored). The bare word מבוטח (with or
 * without the ה prefix) and no number must be ignored.
 */
import { describe, expect, it } from "vitest";
import { israeliInsuredRecognizer } from "./israeliInsured";

describe("israeliInsuredRecognizer", () => {
  it("detects a plain insured number", () => {
    const spans = israeliInsuredRecognizer.recognize("מבוטח 123456");
    expect(spans).toHaveLength(1);
    expect("מבוטח 123456".slice(spans[0].start, spans[0].end)).toBe("123456");
    expect(spans[0].type).toBe("IL_INSURED");
  });

  it("handles מספר מבוטח and מבוטח מס׳, flagging only the number", () => {
    const a = israeliInsuredRecognizer.recognize("מספר מבוטח 9988776");
    expect(a).toHaveLength(1);
    expect("מספר מבוטח 9988776".slice(a[0].start, a[0].end)).toBe("9988776");
    expect(israeliInsuredRecognizer.recognize("מבוטח מס' 445566")).toHaveLength(1);
  });

  it("finds an insured number inside a Hebrew sentence with correct offsets", () => {
    const text = "הפניה נרשמה עבור מבוטח 778899 בקופה";
    const spans = israeliInsuredRecognizer.recognize(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("778899");
  });

  it("ignores the bare word מבוטח with no number", () => {
    expect(israeliInsuredRecognizer.recognize("המבוטח הגיש תביעה")).toHaveLength(0);
  });
});
