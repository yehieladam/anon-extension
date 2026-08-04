/**
 * key serialization — CSV (RFC-4180) and canonical key.v1 JSON, both lossless round-trips incl.
 * Hebrew values with commas/quotes/newlines; malformed key files are rejected.
 */
import { describe, expect, it } from "vitest";
import type { KeyRow } from "./types";
import { fromCsv, fromKeyFile, toCsv, toKeyFile } from "./key";

const ROWS: KeyRow[] = [
  { placeholder: "[ת״ז_1]", original: "123456709", type: "ISRAELI_ID" },
  { placeholder: "[שם_1]", original: "ישראל ישראלי", type: "PERSON" },
  { placeholder: "[חשבון_1]", original: "IL620108000000099999999", type: "IL_IBAN" },
];

describe("CSV round-trip", () => {
  it("is lossless for typical rows", () => {
    expect(fromCsv(toCsv(ROWS))).toEqual(ROWS);
  });

  it("survives values containing commas, quotes and newlines", () => {
    const tricky: KeyRow[] = [
      { placeholder: "[שם_1]", original: 'כהן, ישראל "עו״ד"', type: "PERSON" },
      { placeholder: "[מקום_1]", original: "רחוב הרצל 1\nתל אביב", type: "LOCATION" },
    ];
    expect(fromCsv(toCsv(tricky))).toEqual(tricky);
  });

  it("emits a header-only CSV for no rows, and parses it back to []", () => {
    expect(toCsv([])).toBe("placeholder,original,type");
    expect(fromCsv(toCsv([]))).toEqual([]);
  });
});

describe("key.v1 JSON round-trip", () => {
  it("is lossless and carries optional docId/createdAt", () => {
    const json = toKeyFile(ROWS, { docId: "abc123", createdAt: "2026-08-04T00:00:00Z" });
    expect(JSON.parse(json)).toMatchObject({ version: "key.v1", docId: "abc123" });
    expect(fromKeyFile(json)).toEqual(ROWS);
  });

  it("omits meta fields when not provided", () => {
    const parsed = JSON.parse(toKeyFile(ROWS));
    expect(parsed.docId).toBeUndefined();
    expect(parsed.createdAt).toBeUndefined();
  });

  it("rejects an unrecognized key file", () => {
    expect(() => fromKeyFile('{"version":"nope","rows":[]}')).toThrow();
    expect(() => fromKeyFile('{"rows":[]}')).toThrow();
    expect(() => fromKeyFile('"not an object"')).toThrow();
  });
});
