/**
 * Save-options guard (Fable 5) — proves that a weakened save LEAKS on a base-font PDF where the PII is
 * stored as ASCII (so layer B can SEE it), AND that OUR pdfVerify.layerB actually catches that leak.
 * If `{}` / `{compress:true}` do not fail layer B here, either SAFE_SAVE_OPTIONS is being weakened or
 * the verifier is blind — both block the PDF path. This is the test that keeps the production
 * self-verify honest.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { extractPdfMapped } from "./pdfRedact";
import { anonymizeDeterministic } from "@engine/pipeline";
import { quadsForSpan, refsToRects } from "@engine/pdfText";
import { layerB } from "@engine/pdfVerify";

const NEEDLES = ["123456709", "052-1234567"];

/* eslint-disable @typescript-eslint/no-explicit-any -- mupdf's WASM surface is untyped */
function latinBytes(): Uint8Array {
  return new Uint8Array(
    fs.readFileSync(fileURLToPath(new URL("../../../web/test-fixtures/latin.pdf", import.meta.url))),
  );
}

/** Redact the latin fixture through our pipeline and save with the given options. */
async function redactAndSave(saveOptions: Record<string, unknown>): Promise<Uint8Array> {
  const mupdf = (await import("mupdf")) as any;
  const src = latinBytes();
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
  return new Uint8Array(doc.saveToBuffer(saveOptions).asUint8Array());
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("save-options matrix — layer B must catch the leak on a base-font PDF", () => {
  it("a plain save {} leaks the orphaned content stream — layer B FAILS", async () => {
    const bytes = await redactAndSave({});
    expect((await layerB(bytes, NEEDLES)).pass).toBe(false);
  });

  it("compress-only leaks too — layer B FAILS", async () => {
    const bytes = await redactAndSave({ compress: true });
    expect((await layerB(bytes, NEEDLES)).pass).toBe(false);
  });

  it("garbage-collecting save (SAFE_SAVE_OPTIONS) truly removes it — layer B PASSES", async () => {
    const bytes = await redactAndSave({ garbage: "deduplicate", compress: true, sanitize: true });
    expect((await layerB(bytes, NEEDLES)).pass).toBe(true);
  });
});
