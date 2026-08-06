/** H1 fix reality: redactPdf must NOT false-throw when a redacted short name survives only as a
 * substring of a legit word ("כהן" in "מכהן"/"הכהן"), and MUST still throw on a real whole-word survivor.
 * Gated behind RUN_OCR (builds a PDF via playwright; uses mupdf in node). */
import { describe, expect, it } from "vitest";
import { anonymizeWith } from "@engine/pipeline";
import { manualSpans } from "@engine/manual";
import { redactPdf } from "./pdfRedact";
const run = process.env.RUN_OCR ? describe : describe.skip;

async function pdfOf(lines: string[]): Promise<ArrayBuffer> {
  const { chromium } = await import("playwright");
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(`<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8"><body style="font-family:Arial;font-size:16px;direction:rtl;padding:40px;line-height:2">${lines.map((l) => `<p>${l}</p>`).join("")}</body></html>`, { waitUntil: "networkidle" });
  const pdf = await p.pdf({ format: "A4" });
  await b.close();
  return pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
}
const redactName = (name: string) => async (text: string) => anonymizeWith(text, manualSpans(text, [name]));

run("redactPdf H1 self-verify", () => {
  it("does NOT false-throw: name redacted whole-word, survives only inside longer legit words", async () => {
    // "כהן" is a redaction term; "מכהן"/"הכהן" are legit words that merely contain it.
    const buf = await pdfOf(["התובע מר כהן הגיש תביעה", "הנתבע מכהן בתפקיד בכיר", "בנוכחות הכהן הגדול"]);
    const { bytes, result } = await redactPdf(buf, redactName("כהן"));
    expect(bytes.length).toBeGreaterThan(0); // resolved, no false throw
    expect(result.anonymizedText).not.toContain("מר כהן"); // the real name IS redacted
  }, 120_000);

  // The throw path (a real whole-word survivor is still caught) is pinned model-free in
  // engine/src/textLeaks.test.ts #2 — layerA is a pure function of the re-extracted text.
});
