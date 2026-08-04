/**
 * PDF-03 mapped-extraction gate (Vitest, node — mupdf runs there). Asserts the walk-only design on
 * BOTH fixtures:
 *  - the REAL Chromium/HarfBuzz-shaped PDF (what users upload) is the representative gate;
 *  - the SYNTHETIC logical-authored PDF documents the trap (name comes out reversed) + covers Type0.
 *
 * Encodes Fable's requirements: contiguity of PII values after mupdf's reorder, span→rect merging, and
 * a test proving a sort-by-x reconstruction (rejected option A) would REVERSE the real fixture.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { extractPdfMapped } from "./pdfRedact";
import { detectDeterministic } from "@engine/pipeline";
import { quadsForSpan, refsToRects } from "@engine/pdfText";

function readAsArrayBuffer(relPath: string): ArrayBuffer {
  const abs = fileURLToPath(new URL(`../../../${relPath}`, import.meta.url));
  return new Uint8Array(fs.readFileSync(abs)).buffer;
}

describe("extractPdfMapped — real (Chromium-shaped) fixture", () => {
  it("yields Hebrew names in logical order and deterministic PII, all contiguous", async () => {
    const mapped = await extractPdfMapped(
      readAsArrayBuffer("web/test-fixtures/pdf/chromium-hebrew.pdf"),
    );
    // mupdf's bidi gives the name in logical order — and it is CONTIGUOUS (safety-net assumption).
    expect(mapped.text).toContain("ישראל ישראלי");
    // Deterministic PII stays a contiguous LTR run regardless of the mixed-line reorder.
    expect(mapped.text).toContain("123456709");
    expect(mapped.text).toContain("052-1234567");
  });

  it("detects ID + phone and maps each to a single merged rect on the page", async () => {
    const mapped = await extractPdfMapped(
      readAsArrayBuffer("web/test-fixtures/pdf/chromium-hebrew.pdf"),
    );
    const spans = detectDeterministic(mapped.text);
    const id = spans.find((s) => s.type === "ISRAELI_ID");
    const phone = spans.find((s) => s.type === "IL_PHONE");
    expect(id).toBeDefined();
    expect(phone).toBeDefined();

    const idRects = refsToRects(quadsForSpan(mapped, id!.start, id!.end));
    expect(idRects).toHaveLength(1); // one line → one box
    expect(idRects[0].pageIndex).toBe(0);
    expect(idRects[0].x1).toBeGreaterThan(idRects[0].x0);
    expect(idRects[0].y1).toBeGreaterThan(idRects[0].y0);
  });

  it("a sort-by-x reconstruction (rejected option A) would REVERSE the name here", async () => {
    const mapped = await extractPdfMapped(
      readAsArrayBuffer("web/test-fixtures/pdf/chromium-hebrew.pdf"),
    );
    const at = mapped.text.indexOf("ישראל");
    expect(at).toBeGreaterThanOrEqual(0);
    const xs: number[] = [];
    for (let i = at; i < at + "ישראל".length; i += 1) {
      xs.push(mapped.refs[i]!.quad[0]);
    }
    // Logical order on a real RTL PDF runs right-to-left → DESCENDING x. So sorting by ascending x
    // (option A) would reverse the letters into a wrong, undetectable name. This guards the decision.
    expect(xs).toEqual([...xs].sort((a, b) => b - a));
    expect(xs).not.toEqual([...xs].sort((a, b) => a - b));
  });
});

describe("extractPdfMapped — synthetic (logical-authored) fixture documents the trap", () => {
  it("finds the ID but extracts the Hebrew name REVERSED (the PDF-03 pitfall)", async () => {
    const mapped = await extractPdfMapped(readAsArrayBuffer("web/test-fixtures/hebrew.pdf"));
    expect(mapped.text).toContain("123456709"); // deterministic PII still findable
    // Authored logical-LTR → mupdf extracts the name reversed; NER would miss it without the real
    // shaping. This is exactly why the representative gate is the Chromium fixture, not this one.
    expect(mapped.text).not.toContain("ישראל ישראלי");
  });
});
