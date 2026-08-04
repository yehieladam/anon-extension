// INVESTIGATION 2: the rasterize -> paint -> re-encode fallback. Even if native
// image-pixel redaction were unavailable, we can always: render the page to a
// pixmap (pure WASM), paint an opaque box over the PII region ON the raster,
// then build a brand-new single-image PDF from the painted raster. The original
// pixels never enter the new file, so destruction is guaranteed by construction.
import * as mupdf from 'mupdf';
import fs from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, rectToPixels, pixmapToImageOnlyPdf, writeOut,
} from './scan-lib.mjs';
import { acceptScan } from './verify.mjs';
import { makeWorker } from './ocr.mjs';

const SAFE_SAVE_OPTIONS = { garbage: 'deduplicate', compress: true, sanitize: true };
const RENDER_DPI = 150;

const rects = JSON.parse(fs.readFileSync(join(ROOT, 'fixtures', 'pii-rects.json'), 'utf8'));
const scanBytes = Uint8Array.from(fs.readFileSync(join(ROOT, 'fixtures', 'scan-150.pdf')));

// Paint an opaque black rectangle directly onto an RGB pixmap (top-down px).
function paintBox(pix, r, value = 0) {
  const px = pix.getPixels();
  const n = pix.getNumberOfComponents();
  const stride = pix.getStride();
  const yEnd = Math.min(r.y1, pix.getHeight());
  const xEnd = Math.min(r.x1, pix.getWidth());
  for (let y = r.y0; y < yEnd; y++) {
    for (let x = r.x0; x < xEnd; x++) {
      const o = y * stride + x * n;
      px[o] = value; px[o + 1] = value; px[o + 2] = value;
    }
  }
}

async function main() {
  console.log('=== FALLBACK rasterize -> paint -> re-embed ===');
  const worker = await makeWorker({ best: true, psm: '6' });

  const doc = mupdf.PDFDocument.openDocument(scanBytes, 'application/pdf');
  const s = RENDER_DPI / 72;
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false);

  for (const key of ['name', 'id', 'phone']) {
    paintBox(pix, rectToPixels(rects[key], RENDER_DPI), 0);
  }
  writeOut('fallback-painted-raster.png', pix);

  const { bytes } = pixmapToImageOnlyPdf(pix, SAFE_SAVE_OPTIONS);
  const out = Uint8Array.from(bytes);
  const outPath = writeOut('fallback-redacted.pdf', out);

  const res = await acceptScan(out, rects, worker);
  console.log(`\noutput: ${outPath}`);
  console.log(`  images in output: ${res.imageCount}`);
  console.log(`  PII still readable in embedded image: ${JSON.stringify(res.survivedInImage)}`);
  console.log(`  region means (embedded image): ${JSON.stringify(res.regionMeans)}`);
  console.log(`  raw byte-scan hits: ${JSON.stringify(res.byteHits)}`);
  console.log(`  => ${res.pass ? 'TRUE DESTRUCTION' : 'FAIL (pixels/PII survive)'}`);

  await worker.terminate();
}

main();
