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
import { extractPdfMapped, redactPdf } from "./pdfRedact";
import { anonymizeDeterministic, anonymizeFull, detectDeterministic } from "@engine/pipeline";
import { quadsForSpan, refsToRects } from "@engine/pdfText";
import { layerB, layerC } from "@engine/pdfVerify";

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

describe("redactPdf — true removal + in-production self-verify (real fixture)", () => {
  it("removes detected ID + phone, and the redacted bytes pass all three layers", async () => {
    // redactPdf self-verifies internally: if it returns, the 3-layer check already passed.
    const { bytes, result } = await redactPdf(
      readAsArrayBuffer("web/test-fixtures/pdf/chromium-hebrew.pdf"),
      anonymizeDeterministic,
    );
    const originals = result.key.map((r) => r.original);
    expect(originals).toContain("123456709"); // ID was detected...
    expect(originals).toContain("052-1234567"); // ...and phone

    // Re-extract the redacted PDF: the values are gone from the readable text.
    const reExtracted = await extractPdfMapped(bytes.buffer.slice(0) as ArrayBuffer);
    expect(reExtracted.text).not.toContain("123456709");
    expect(reExtracted.text).not.toContain("052-1234567");

    // And gone from the raw bytes (incl. inflated streams) — the true gate.
    const b = await layerB(bytes, originals);
    expect(b.pass).toBe(true);
  });

  it("proves an incremental save would FAIL the byte scan — guards SAFE_SAVE_OPTIONS", async () => {
    // Replicate the redaction but save INCREMENTALLY; the append keeps the pre-redaction objects
    // recoverable and layer B catches the PII. This is why SAFE_SAVE_OPTIONS (full rewrite + garbage)
    // must never be weakened.
    // reason: mupdf's WASM surface is untyped; narrowly used to build a leaky-save counter-example.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const mupdf = (await import("mupdf")) as any;
    const src = new Uint8Array(
      fs.readFileSync(fileURLToPath(new URL("../../../web/test-fixtures/pdf/chromium-hebrew.pdf", import.meta.url))),
    );
    const doc = mupdf.PDFDocument.openDocument(src, "application/pdf");
    const mapped = await extractPdfMapped(src.buffer.slice(0) as ArrayBuffer);
    const result = anonymizeDeterministic(mapped.text);
    const rects = result.spans.flatMap((s) => refsToRects(quadsForSpan(mapped, s.start, s.end)));
    const P = mupdf.PDFPage;
    for (const r of rects) {
      const page = doc.loadPage(r.pageIndex);
      const annot = page.createAnnotation("Redact");
      annot.setRect([r.x0, r.y0, r.x1, r.y1]);
      annot.update();
    }
    doc.loadPage(0).applyRedactions(true, P.REDACT_IMAGE_PIXELS, P.REDACT_LINE_ART_NONE, P.REDACT_TEXT_REMOVE);
    const leaky = new Uint8Array(doc.saveToBuffer({ incremental: true }).asUint8Array());
    // An incremental save appends a second body+xref, leaving the pre-redaction generation
    // recoverable — layer C sees more than one %%EOF/startxref and rejects it. redactPdf's
    // self-verify runs exactly this check, so it can never return an incrementally-saved file.
    const c = layerC(leaky);
    expect(c.pass).toBe(false);
    expect(c.eofCount).toBeGreaterThan(1);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
});

describe("redactPdf — NER name spans are truly removed (model-free, via injected anonymize)", () => {
  it("removes a Hebrew PERSON name from the PDF when a name span is detected", async () => {
    const NAME = "ישראל ישראלי";
    // Stand in for the NER pass: mark the name as a PERSON span, merged with deterministic detection.
    // (NER detection itself is proven separately; this isolates the PDF name-redaction path from the
    // 185 MB model download so it runs offline in CI.)
    const withName = (text: string) => {
      // Every occurrence — the name appears on more than one line, and self-verify (correctly) fails
      // if any mention survives. Real NER returns all mentions too.
      const spans = [];
      for (let at = text.indexOf(NAME); at >= 0; at = text.indexOf(NAME, at + NAME.length)) {
        spans.push({ start: at, end: at + NAME.length, type: "PERSON" as const, score: 0.99 });
      }
      return anonymizeFull(text, spans);
    };
    const { bytes, result } = await redactPdf(
      readAsArrayBuffer("web/test-fixtures/pdf/chromium-hebrew.pdf"),
      withName,
    );
    expect(result.key.some((r) => r.type === "PERSON" && r.original === NAME)).toBe(true);
    // Re-extract: the name is gone (redactPdf would have thrown on self-verify otherwise).
    const reExtracted = await extractPdfMapped(bytes.buffer.slice(0) as ArrayBuffer);
    expect(reExtracted.text).not.toContain(NAME);
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
