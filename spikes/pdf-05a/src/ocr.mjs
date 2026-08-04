// Thin tesseract.js wrapper for the spike. Uses tessdata_best `heb` by default
// (langPath -> projectnaptha _best mirror), cached locally under ./tessdata so
// the traineddata is downloaded once and its size is measurable. The tesseract
// CORE wasm ships inside node_modules/tesseract.js-core (offline).
import { createWorker } from 'tesseract.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, '..', 'tessdata');

// tessdata_best gives materially better Hebrew than the default "fast" data.
const BEST = 'https://tessdata.projectnaptha.com/4.0.0_best';
const FAST = 'https://tessdata.projectnaptha.com/4.0.0';

export async function makeWorker({ best = true, psm = '6', langs = 'heb+eng' } = {}) {
  const worker = await createWorker(langs, 1, {
    langPath: best ? BEST : FAST,
    cachePath: CACHE,
    gzip: true,
  });
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: '1',
  });
  return worker;
}

// Recognize a PNG buffer / Uint8Array; returns { text, meanConf }.
export async function ocrPng(worker, pngBytes) {
  const { data } = await worker.recognize(Buffer.from(pngBytes));
  return { text: data.text || '', meanConf: data.confidence ?? null };
}
