/**
 * OCR reality harness (heavy — GATED behind RUN_OCR, never in CI). Proves real Hebrew+digit OCR on a
 * rendered scan and that the scan-quality gate reacts to real confidence: rasterize the committed
 * Hebrew PDF to an image (a synthetic "scan", no text layer), run tesseract (heb+eng) with the vendored
 * traineddata, and assert the name + ID + phone are read and the gate passes; then degrade the image
 * and assert the gate refuses. tesseract.js runs in node (PDF-05a), so this is the model-free-in-CI
 * analogue done manually with the 21 MiB assets.
 *
 *   $env:RUN_OCR=1; npx vitest run web/src/worker/ocr.node.test.ts
 *
 * The vendored traineddata must exist (run scripts/fetch-tesseract-assets.mjs first).
 */
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateScanQuality } from "@engine/scanGate";
import type { OcrPageResult, OcrWord } from "@engine/ocrTypes";

const run = process.env.RUN_OCR ? describe : describe.skip;

/* eslint-disable @typescript-eslint/no-explicit-any -- mupdf + tesseract node surfaces are untyped */
function abs(rel: string): string {
  return fileURLToPath(new URL(rel, import.meta.url));
}

/** Rasterize page 0 of a PDF to a PNG buffer at the given DPI (mupdf). */
async function rasterize(pdfRel: string, dpi: number, noise = 0): Promise<{ png: Uint8Array; w: number; h: number }> {
  const mupdf: any = await import("mupdf");
  const doc = mupdf.PDFDocument.openDocument(readFileSync(abs(pdfRel)), "application/pdf");
  const scale = dpi / 72;
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
  if (noise > 0) {
    const px = pix.getPixels();
    for (let i = 0; i < px.length; i += 1) {
      // deterministic-ish perturbation (no Math.random dependency on determinism) — enough to degrade OCR
      const n = ((i * 2654435761) % 512) / 512 - 0.5;
      px[i] = Math.max(0, Math.min(255, px[i] + n * 2 * noise));
    }
  }
  return { png: new Uint8Array(pix.asPNG()), w: pix.getWidth(), h: pix.getHeight() };
}

async function ocr(png: Uint8Array, w: number, h: number): Promise<OcrPageResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("heb+eng", 1, {
    langPath: abs("../../public/vendor/tessdata"),
    cachePath: abs("../../public/vendor/tessdata"),
    gzip: true,
  } as any);
  await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" } as any);
  const { data }: any = await worker.recognize(Buffer.from(png), {}, { blocks: true });
  await worker.terminate();
  const words: OcrWord[] = (data.words ?? (data.blocks ?? []).flatMap((b: any) =>
    (b.paragraphs ?? []).flatMap((p: any) => (p.lines ?? []).flatMap((l: any) => l.words ?? [])),
  )).map((wd: any) => ({
    text: String(wd.text ?? ""),
    confidence: Number(wd.confidence ?? 0),
    bbox: { x0: wd.bbox?.x0 ?? 0, y0: wd.bbox?.y0 ?? 0, x1: wd.bbox?.x1 ?? 0, y1: wd.bbox?.y1 ?? 0 },
  }));
  return { words, meanConfidence: Number(data.confidence ?? 0), imageWidth: w, imageHeight: h };
}

run("OCR reality — real Hebrew scan", () => {
  it("reads the name + ID + phone from a clean scan and the gate passes", async () => {
    const { png, w, h } = await rasterize("../../test-fixtures/pdf/chromium-hebrew.pdf", 200);
    const page = await ocr(png, w, h);
    const text = page.words.map((word) => word.text).join(" ");
    // eslint-disable-next-line no-console
    console.log(`clean: meanConf=${page.meanConfidence.toFixed(1)} words=${page.words.length}\n${text}`);
    expect(text).toContain("123456709");
    expect(text.replace(/\s/g, "")).toContain("ישראל");
    expect(page.words.every((word) => word.bbox.x1 >= word.bbox.x0 && word.bbox.y1 >= word.bbox.y0)).toBe(true);
    expect(evaluateScanQuality(page).ok).toBe(true);
  }, 300_000);

  it("refuses a heavily degraded scan via the quality gate", async () => {
    const { png, w, h } = await rasterize("../../test-fixtures/pdf/chromium-hebrew.pdf", 90, 140);
    const page = await ocr(png, w, h);
    // eslint-disable-next-line no-console
    console.log(`degraded: meanConf=${page.meanConfidence.toFixed(1)} words=${page.words.length} gate=${JSON.stringify(evaluateScanQuality(page))}`);
    expect(evaluateScanQuality(page).ok).toBe(false);
  }, 300_000);
});
/* eslint-enable @typescript-eslint/no-explicit-any */
