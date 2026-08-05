/**
 * OCR primitive (heavy WASM) — runs tesseract.js in the engine worker to read a rendered scan page.
 * Lives in the worker layer (never engine): the engine only reasons about the pure OcrPageResult it
 * produces. Lazy-loaded: tesseract + the ~21 MiB heb/eng traineddata are fetched ONLY when a scan is
 * actually processed (P0I-02), and ONLY from our own origin (/vendor/*) — no CDN, so the CSP stays
 * `connect-src 'self'` and the zero-network promise holds (the assets are vendored at build time by
 * scripts/fetch-tesseract-assets.mjs).
 *
 * heb+eng: Hebrew for the text, English required for reliable digits (Israeli ID / phone) — PDF-05a.
 */
import type { OcrPageResult, OcrWord } from "@engine/ocrTypes";

// Same-origin vendored paths (see scripts/fetch-tesseract-assets.mjs). Absolute so they resolve the
// same from the worker realm regardless of the document URL.
const WORKER_PATH = "/vendor/tesseract/worker.min.js";
const CORE_PATH = "/vendor/tesseract";
const LANG_PATH = "/vendor/tessdata";

// reason: tesseract.js's recognize result is loosely typed across v5 minor versions (words vs blocks);
// we narrow the two shapes we read below rather than model the whole surface.
/* eslint-disable @typescript-eslint/no-explicit-any */
type TessWorker = { recognize: (image: any, opts?: any, output?: any) => Promise<{ data: any }> };

let workerPromise: Promise<TessWorker> | null = null;

/** Lazy singleton tesseract worker (heb+eng, LSTM, single uniform block PSM 6). */
async function getOcrWorker(): Promise<TessWorker> {
  if (workerPromise === null) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("heb+eng", 1, {
        workerPath: WORKER_PATH,
        corePath: CORE_PATH,
        langPath: LANG_PATH,
        gzip: true,
      });
      await worker.setParameters({
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1",
      } as any);
      return worker as unknown as TessWorker;
    })();
  }
  return workerPromise;
}

/** Flatten tesseract's result to our words, tolerating the v5 words-vs-blocks output shapes. */
function toWords(data: any): OcrWord[] {
  const collect = (node: any, out: OcrWord[]): void => {
    if (Array.isArray(node?.words)) {
      for (const w of node.words) {
        out.push({
          text: String(w.text ?? ""),
          confidence: Number(w.confidence ?? 0),
          bbox: {
            x0: Number(w.bbox?.x0 ?? 0),
            y0: Number(w.bbox?.y0 ?? 0),
            x1: Number(w.bbox?.x1 ?? 0),
            y1: Number(w.bbox?.y1 ?? 0),
          },
        });
      }
      return;
    }
    for (const child of node?.paragraphs ?? node?.lines ?? node?.blocks ?? []) {
      collect(child, out);
    }
  };
  const out: OcrWord[] = [];
  if (Array.isArray(data?.words) && data.words.length > 0) {
    collect(data, out);
  } else {
    for (const block of data?.blocks ?? []) {
      collect(block, out);
    }
  }
  return out;
}

/**
 * OCR a rendered scan page (a PNG byte buffer) into words + confidences + the page mean. Coordinates
 * are image pixels; imageWidth/imageHeight come from tesseract's page dimensions.
 */
export async function ocrImage(image: Uint8Array): Promise<OcrPageResult> {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(image, {}, { blocks: true });
  const words = toWords(data);
  return {
    words,
    meanConfidence: Number(data?.confidence ?? 0),
    imageWidth: Number(data?.imageWidth ?? data?.width ?? 0),
    imageHeight: Number(data?.imageHeight ?? data?.height ?? 0),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
