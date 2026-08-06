/**
 * Scan redaction reality harness (heavy — GATED behind RUN_OCR, never in CI). Proves the Stage-3 path
 * end-to-end on a REAL image-only scan: build a scanned PDF (rasterize the committed Hebrew fixture and
 * embed it as a full-page image — no text layer), run redactScan with node tesseract injected, then
 * RE-OCR the output and assert the PII pixels are actually gone. This is the analogue of the model-free
 * CI tests, done manually with the 21 MiB tesseract assets + node mupdf.
 *
 *   $env:RUN_OCR=1; npx vitest run web/src/worker/scanRedact.node.test.ts
 *
 * Requires the vendored traineddata (scripts/fetch-tesseract-assets.mjs). The d2 all-1s-ID detection
 * (the calibration worst case) is proven at the unit level in engine/src/detectScanPii.test.ts case 2;
 * here we prove the generic OCR -> detect -> REDACT_IMAGE_PIXELS -> re-OCR-blank chain on real pixels.
 */
import { setDefaultResultOrder } from "node:dns";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { anonymizeDeterministic, anonymizeWith } from "@engine/pipeline";
import { labelAnchorBoxes, detectScanPii } from "@engine/detectScanPii";
import { restore } from "@engine/restore";
import type { OcrPageResult, OcrWord } from "@engine/ocrTypes";
import { redactScan, selfVerifyScan, SCAN_LOW_CONFIDENCE, SCAN_SELFVERIFY_FAILED, type ScanDetect } from "./scanRedact";

setDefaultResultOrder("ipv4first"); // the dev machine's IPv6 route to HF is dead (any NER model fetch)

const fullDetect: ScanDetect = (page) => detectScanPii(page, anonymizeDeterministic);

const run = process.env.RUN_OCR ? describe : describe.skip;

/* eslint-disable @typescript-eslint/no-explicit-any -- mupdf + tesseract node surfaces are untyped */
function abs(rel: string): string {
  return fileURLToPath(new URL(rel, import.meta.url));
}
const SOURCE = "../../test-fixtures/pdf/chromium-hebrew.pdf"; // name ישראל ישראלי, ID 123456709, phone 052-1234567

/** Rasterize page 0 of a PDF to a pixmap at the given DPI, optionally adding deterministic noise. */
function rasterPixmap(mupdf: any, srcRel: string, dpi: number, noise = 0): any {
  const src = mupdf.PDFDocument.openDocument(readFileSync(abs(srcRel)), "application/pdf");
  const pix = src.loadPage(0).toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false);
  if (noise > 0) {
    const px = pix.getPixels();
    for (let i = 0; i < px.length; i += 1) {
      const n = ((i * 2654435761) % 512) / 512 - 0.5;
      px[i] = Math.max(0, Math.min(255, px[i] + n * 2 * noise));
    }
  }
  return pix;
}

/** Wrap a pixmap as a single full-page-image PDF (a synthetic scan: image only, NO text layer). */
function scanPdfFromPixmap(mupdf: any, pix: any, dpi: number): ArrayBuffer {
  const doc = new mupdf.PDFDocument();
  const imgRef = doc.addImage(new mupdf.Image(pix));
  const resources = doc.addObject({ XObject: { Img: imgRef } });
  const wPt = (pix.getWidth() * 72) / dpi;
  const hPt = (pix.getHeight() * 72) / dpi;
  const contents = `q ${wPt} 0 0 ${hPt} 0 0 cm /Img Do Q`;
  const page = doc.addPage([0, 0, wPt, hPt], 0, resources, contents);
  doc.insertPage(-1, page);
  return new Uint8Array(doc.saveToBuffer({ garbage: "deduplicate" }).asUint8Array()).buffer;
}

/** Node tesseract OCR (heb+eng, PSM 6) -> OcrPageResult. Injected into redactScan in place of ocr.ts. */
async function nodeOcr(png: Uint8Array): Promise<OcrPageResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("heb+eng", 1, {
    langPath: abs("../../public/vendor/tessdata"),
    cachePath: abs("../../public/vendor/tessdata"),
    gzip: true,
  } as any);
  await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" } as any);
  const { data }: any = await worker.recognize(Buffer.from(png), {}, { blocks: true });
  await worker.terminate();
  const rawWords =
    data.words ??
    (data.blocks ?? []).flatMap((b: any) =>
      (b.paragraphs ?? []).flatMap((p: any) => (p.lines ?? []).flatMap((l: any) => l.words ?? [])),
    );
  const words: OcrWord[] = rawWords.map((wd: any) => ({
    text: String(wd.text ?? ""),
    confidence: Number(wd.confidence ?? 0),
    bbox: { x0: wd.bbox?.x0 ?? 0, y0: wd.bbox?.y0 ?? 0, x1: wd.bbox?.x1 ?? 0, y1: wd.bbox?.y1 ?? 0 },
  }));
  return { words, meanConfidence: Number(data.confidence ?? 0), imageWidth: 0, imageHeight: 0 };
}

/** Re-OCR page 0 of a produced PDF -> its plain text (digits normalized), for the leak assertion. */
async function reOcrText(bytes: Uint8Array): Promise<string> {
  const mupdf: any = await import("mupdf");
  const pix = mupdf.PDFDocument.openDocument(bytes, "application/pdf")
    .loadPage(0)
    .toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceRGB, false);
  const page = await nodeOcr(new Uint8Array(pix.asPNG()));
  return page.words.map((w) => w.text).join(" ");
}

run("scan redaction reality — real image-only scan", () => {
  it("removes the ID + phone pixels: re-OCR of the redacted output cannot find them", async () => {
    const mupdf: any = await import("mupdf");
    const scan = scanPdfFromPixmap(mupdf, rasterPixmap(mupdf, SOURCE, 200), 200);

    const { bytes } = await redactScan(scan, anonymizeDeterministic, nodeOcr);

    // Output re-opens (corruption gate) and re-OCR finds neither the ID nor the phone digits.
    expect(mupdf.PDFDocument.openDocument(bytes, "application/pdf").countPages()).toBeGreaterThanOrEqual(1);
    const reText = await reOcrText(bytes);
    // eslint-disable-next-line no-console
    console.log(`re-OCR of redacted output:\n${reText}`);
    const text = reText.replace(/\s/g, "");
    expect(text).not.toContain("123456709"); // ID gone (deterministic A + digit-relax B both covered it)
    expect(text).not.toContain("0521234567"); // phone digits gone (self-heal: bbox pixels removed)
    // R1/R3/R4: redactScan resolving means its internal fixed-point self-verify PASSED — despite the
    // fixture's labels (label-anchor whites label+value, so no lone label re-anchors) and digit runs
    // (B whites them). No false refuse from over-redaction idempotency.
  }, 300_000);

  it("self-verify THROWS when a PII survives in the output (fixed-point, the headline)", async () => {
    // R2: run selfVerifyScan against an UN-redacted scan (the ID is fully legible) with a real detector
    // and page 0 marked redacted — the surviving ID must be re-detected -> SCAN_SELFVERIFY_FAILED. Proves
    // the verify actually catches a leak, not merely passes a clean file.
    const mupdf: any = await import("mupdf");
    const scan = scanPdfFromPixmap(mupdf, rasterPixmap(mupdf, SOURCE, 200), 200);
    await expect(selfVerifyScan(new Uint8Array(scan), nodeOcr, fullDetect, [0])).rejects.toThrow(SCAN_SELFVERIFY_FAILED);
  }, 300_000);

  it("self-verify PASSES on the redacted output (fixed point reached)", async () => {
    // R1 explicit: the redacted output re-detects to zero boxes.
    const mupdf: any = await import("mupdf");
    const scan = scanPdfFromPixmap(mupdf, rasterPixmap(mupdf, SOURCE, 200), 200);
    const { bytes } = await redactScan(scan, anonymizeDeterministic, nodeOcr, fullDetect);
    await expect(selfVerifyScan(bytes, nodeOcr, fullDetect, [0])).resolves.toBeUndefined();
  }, 300_000);

  it("full redactScan THROWS to the caller on an execution fault (mislocated rects)", async () => {
    // R5 (seam propagation): a detect that correctly finds the PII but returns boxes at the WRONG pixel
    // location (simulating a coordinate-mapping bug) whites empty corners; the real PII survives; the
    // INTERNAL self-verify re-detects it and the throw must propagate OUT of redactScan to the caller.
    const mupdf: any = await import("mupdf");
    const scan = scanPdfFromPixmap(mupdf, rasterPixmap(mupdf, SOURCE, 200), 200);
    const mislocated: ScanDetect = async (page) => {
      const d = await detectScanPii(page, anonymizeDeterministic);
      return { ...d, boxes: d.boxes.map(() => ({ x0: 0, y0: 0, x1: 1, y1: 1 })) };
    };
    await expect(redactScan(scan, anonymizeDeterministic, nodeOcr, mislocated)).rejects.toThrow(SCAN_SELFVERIFY_FAILED);
  }, 300_000);

  it("label-anchor specifically removes real ID pixels (digit detectors bypassed)", async () => {
    // Closes the composition seam in the #11 split: prove a LABEL-ANCHOR bbox lands on and removes real
    // pixels (not just that it detects, and not via the digit detector). Inject a detect that runs ONLY
    // label-anchor, so the labeled `תעודת זהות 123456709` region can be removed by nothing else. The
    // fixture has TWO ID occurrences; only the FIRST is labeled `תעודת זהות` (the second is `מספר …`,
    // not a lexicon label), so label-anchor-only must drop the count from 2 to 1.
    const mupdf: any = await import("mupdf");
    const scan = scanPdfFromPixmap(mupdf, rasterPixmap(mupdf, SOURCE, 200), 200);
    const before = (await reOcrText(new Uint8Array(scan))).replace(/\s/g, "");
    expect(before.split("123456709").length - 1).toBe(2); // baseline: two ID occurrences readable

    const labelOnly: ScanDetect = async (page) => ({
      boxes: labelAnchorBoxes(page.words),
      spans: [],
      text: "",
    });
    const { bytes } = await redactScan(scan, anonymizeDeterministic, nodeOcr, labelOnly);
    const after = (await reOcrText(bytes)).replace(/\s/g, "");
    // eslint-disable-next-line no-console
    console.log(`label-anchor-only re-OCR:\n${await reOcrText(bytes)}`);
    expect(after.split("123456709").length - 1).toBe(1); // the LABELED ID's pixels are gone
  }, 300_000);

  it("refuses a heavily degraded scan via the quality gate (whole-file, no bytes)", async () => {
    const mupdf: any = await import("mupdf");
    const scan = scanPdfFromPixmap(mupdf, rasterPixmap(mupdf, SOURCE, 90, 140), 90);
    await expect(redactScan(scan, anonymizeDeterministic, nodeOcr)).rejects.toThrow(SCAN_LOW_CONFIDENCE);
  }, 300_000);

  it("redacts a Hebrew NAME on a scan via NER — re-OCR finds no name (pre-flip checklist #4)", async () => {
    // The name-on-scan proof: real tesseract OCR -> real Hebrew NER on the OCR text -> the PERSON name
    // (both occurrences, via occurrence-completion) is pixel-redacted -> re-OCR of the output finds no
    // "ישראל". This is the substance of the @model scan-names check, runnable from the cached model.
    const { createHebrewNer } = await import("@engine/ner");
    const ner = await createHebrewNer({ device: "cpu" }); // node uses onnxruntime-node (cpu); q8 identical
    const anonymize = async (text: string) => anonymizeWith(text, await ner.recognize(text));
    const mupdf: any = await import("mupdf");
    const scan = scanPdfFromPixmap(mupdf, rasterPixmap(mupdf, SOURCE, 200), 200);
    const { bytes, result } = await redactScan(scan, anonymize, nodeOcr);
    const text = (await reOcrText(bytes)).replace(/\s/g, "");
    // eslint-disable-next-line no-console
    console.log(`name-on-scan re-OCR:\n${await reOcrText(bytes)}\n--- Word-for-AI text ---\n${result.anonymizedText}`);
    // Image channel: PII pixels gone.
    expect(text).not.toContain("ישראל"); // the PERSON name pixels are gone (both occurrences)
    expect(text).not.toContain("123456709"); // ID gone too (deterministic + digit-relax)
    // Stage 6 — AI-usable text channel: tokenized, no raw PII, restores.
    const ai = result.anonymizedText;
    expect(ai).toMatch(/\[ID_\d+\]/); // ID token present
    expect(ai).toMatch(/\[(שם|טלפון)_\d+\]/); // name/phone token present
    expect(ai).not.toContain("123456709"); // no raw ID in the AI text
    expect(ai).not.toContain("0521234567"); // no raw phone digits in the AI text
    expect(result.key.some((r) => r.source === "validated")).toBe(true); // fidelity marked
    expect(restore(ai, result.key).restoredText).toContain("123456709"); // A value round-trips
  }, 600_000);
});
/* eslint-enable @typescript-eslint/no-explicit-any */
