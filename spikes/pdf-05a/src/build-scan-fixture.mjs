// Build the scanned-PDF fixtures: a Hebrew text page rasterized into image-only
// PDFs at 150 and 300 DPI, plus clean + noisy PNGs for the OCR benchmark, plus
// the PII rects (point space) both later stages reuse. All PII is synthetic.
import * as mupdf from 'mupdf';
import fs from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, buildTextDoc, rasterize, pixmapToImageOnlyPdf, writeOut,
} from './scan-lib.mjs';

const SAFE_SAVE_OPTIONS = { garbage: 'deduplicate', compress: true, sanitize: true };

function addNoise(pix, amount) {
  const px = pix.getPixels();
  for (let i = 0; i < px.length; i++) {
    // Skip alpha-less RGB: perturb every sample with uniform noise.
    const n = (Math.random() * 2 - 1) * amount;
    px[i] = Math.max(0, Math.min(255, px[i] + n));
  }
}

function main() {
  const { doc: textDoc, rects } = buildTextDoc();
  fs.writeFileSync(join(ROOT, 'fixtures', 'pii-rects.json'), JSON.stringify(rects, null, 2));

  for (const dpi of [150, 300]) {
    const pix = rasterize(textDoc, dpi);
    const { bytes } = pixmapToImageOnlyPdf(pix, SAFE_SAVE_OPTIONS);
    fs.writeFileSync(join(ROOT, 'fixtures', `scan-${dpi}.pdf`), bytes);
    writeOut(`scan-${dpi}.png`, pix);
    console.log(`scan-${dpi}.pdf  ${bytes.length} bytes  raster ${pix.getWidth()}x${pix.getHeight()}`);
  }

  // Noisy + skewed variant at 150 DPI for the OCR stress tier.
  const skew = mupdf.Matrix.rotate(2.2);
  const noisy = rasterize(textDoc, 150, skew);
  addNoise(noisy, 34);
  writeOut('scan-150-noisy.png', noisy);
  console.log(`scan-150-noisy.png  raster ${noisy.getWidth()}x${noisy.getHeight()} (skew 2.2deg + noise)`);

  console.log('PII rects (points):', JSON.stringify(rects));
}

main();
