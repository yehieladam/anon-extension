/**
 * IL_COMPANY (ח״פ) — 9 digits, leading 5, Luhn-style checksum. Valid samples computed to pass
 * the same check as the ID; invalids flip the last digit. A non-5-leading valid ID must NOT be
 * read as a company.
 */
import { describe, expect, it } from "vitest";
import { isValidIsraeliCompany, israeliCompanyRecognizer } from "./israeliCompany";

const VALID = ["512345679", "500000005", "587654328", "555555556", "510203045"];
const INVALID_CHECKSUM = ["512345670", "500000006", "587654329", "555555557", "510203046"];

describe("isValidIsraeliCompany", () => {
  it.each(VALID)("accepts checksum-valid company number %s", (n) => {
    expect(isValidIsraeliCompany(n)).toBe(true);
  });

  it.each(INVALID_CHECKSUM)("rejects checksum-invalid %s", (n) => {
    expect(isValidIsraeliCompany(n)).toBe(false);
  });

  it("rejects numbers that do not start with 5", () => {
    // 123456709 is a checksum-valid Israeli ID but not a company number.
    expect(isValidIsraeliCompany("123456709")).toBe(false);
  });

  it("rejects wrong-length inputs", () => {
    expect(isValidIsraeliCompany("51234567")).toBe(false);
    expect(isValidIsraeliCompany("5123456790")).toBe(false);
  });
});

describe("israeliCompanyRecognizer", () => {
  it.each(VALID)("detects %s as a standalone number", (n) => {
    const spans = israeliCompanyRecognizer.recognize(n);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ start: 0, end: 9, type: "IL_COMPANY" });
  });

  it.each(INVALID_CHECKSUM)("does not detect %s", (n) => {
    expect(israeliCompanyRecognizer.recognize(n)).toHaveLength(0);
  });

  it("finds a company number in a Hebrew sentence with correct offsets", () => {
    const text = "ח״פ של החברה הוא 512345679 לפי רשם החברות";
    const spans = israeliCompanyRecognizer.recognize(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("512345679");
  });

  it("does not flag a 9-digit window inside a longer digit run", () => {
    expect(israeliCompanyRecognizer.recognize("999512345679")).toHaveLength(0);
  });
});
