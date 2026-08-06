/**
 * Realistic xlsx round-trip: build a workbook the way Excel/Sheets do (via SheetJS — numbers land in
 * NUMERIC cells), redact it, then RE-READ it with SheetJS. Re-reading without throwing is the
 * corruption gate (a malformed part would make SheetJS reject the file / Excel show a repair prompt).
 * Proves the numeric-cell → inline-string rewrite produces a structurally valid workbook.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { redactXlsx } from "./officeRedact";
import { anonymizeDeterministic } from "@engine/pipeline";

describe("redactXlsx — SheetJS-realistic numeric round-trip", () => {
  it("redacts numeric IDs and the output re-reads cleanly (no corruption)", async () => {
    const rows = [
      ["שם", "תעודת זהות", "יתרה"],
      ["ישראל ישראלי", 123456709, 4200], // 9-digit ID as a number
      ["דנה כהן", 12345674, 900], // stored 8-digit → valid 012345674 (leading zero dropped)
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
    const input = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const { bytes, result } = await redactXlsx(
      input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer,
      anonymizeDeterministic,
    );

    // Corruption gate: SheetJS re-reads the redacted workbook without throwing.
    const out = XLSX.read(bytes, { type: "array" });
    const csv = XLSX.utils.sheet_to_csv(out.Sheets[out.SheetNames[0]]);

    expect(csv).not.toContain("123456709");
    expect(csv).not.toContain("12345674");
    expect(csv).toMatch(/\[ID_\d+\]/);
    // Both IDs are in the key; the leading zero is restored on the 8-digit one.
    expect(result.key.map((r) => r.original).sort()).toEqual(["012345674", "123456709"]);
    // Non-PII numbers survive.
    expect(csv).toContain("4200");
    expect(csv).toContain("900");
  });
});
