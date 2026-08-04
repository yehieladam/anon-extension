// INVESTIGATION 1: does native mupdf applyRedactions() with REDACT_IMAGE_PIXELS
// actually destroy pixels inside an embedded SCAN image? We run every image
// method and both an "update-first" and rect-covers-whole-page variant, then
// verify destruction on the DECODED image (not the rendered page).
import * as mupdf from 'mupdf';
import fs from 'node:fs';
import { join } from 'node:path';
import { ROOT, PAGE_W, PAGE_H, writeOut, toMupdfRect } from './scan-lib.mjs';
import { acceptScan } from './verify.mjs';
import { makeWorker } from './ocr.mjs';

const SAFE_SAVE_OPTIONS = { garbage: 'deduplicate', compress: true, sanitize: true };
const P = mupdf.PDFPage;

const rects = JSON.parse(fs.readFileSync(join(ROOT, 'fixtures', 'pii-rects.json'), 'utf8'));
const scanBytes = fs.readFileSync(join(ROOT, 'fixtures', 'scan-150.pdf'));

// One redaction pass. imageMethod varies; `updateFirst` calls page.update()
// before applying; `wholePage` uses one page-sized rect instead of PII rects.
function redact({ imageMethod, updateFirst, wholePage }) {
  const doc = mupdf.PDFDocument.openDocument(Uint8Array.from(scanBytes), 'application/pdf');
  const page = doc.loadPage(0);
  const targets = wholePage
    ? [[0, 0, PAGE_W, PAGE_H]]
    : [rects.name, rects.id, rects.phone].map(toMupdfRect);
  for (const rect of targets) {
    const annot = page.createAnnotation('Redact');
    annot.setRect(rect);
    annot.update();
  }
  if (updateFirst) page.update();
  page.applyRedactions(true, imageMethod, P.REDACT_LINE_ART_NONE, P.REDACT_TEXT_REMOVE);
  const bytes = doc.saveToBuffer(SAFE_SAVE_OPTIONS).asUint8Array();
  return Uint8Array.from(bytes);
}

const METHODS = [
  ['REDACT_IMAGE_PIXELS', P.REDACT_IMAGE_PIXELS],
  ['REDACT_IMAGE_REMOVE', P.REDACT_IMAGE_REMOVE],
  ['REDACT_IMAGE_UNLESS_INVISIBLE', P.REDACT_IMAGE_UNLESS_INVISIBLE],
];

async function main() {
  console.log('=== NATIVE applyRedactions on a real raster scan (mupdf', mupdf.version || '1.28.0', ') ===');
  const worker = await makeWorker({ best: true, psm: '6' });

  // Baseline: prove the PII IS readable in the untouched scan image.
  const base = await acceptScan(scanBytes, rects, worker);
  console.log('\n[baseline scan-150.pdf] PII still in image:', base.survivedInImage,
    '| images:', base.imageCount, '| regionMeans:', JSON.stringify(base.regionMeans));

  const variants = [
    { label: 'PII rects', wholePage: false, updateFirst: false },
    { label: 'PII rects + page.update() first', wholePage: false, updateFirst: true },
    { label: 'whole-page rect', wholePage: true, updateFirst: false },
  ];

  for (const [name, method] of METHODS) {
    for (const v of variants) {
      let out;
      try {
        out = redact({ imageMethod: method, updateFirst: v.updateFirst, wholePage: v.wholePage });
      } catch (err) {
        console.log(`\n[${name} | ${v.label}] THREW: ${err.message}`);
        continue;
      }
      const res = await acceptScan(out, rects, worker);
      const tag = `${name} | ${v.label}`;
      writeOut(`native-${name}-${v.label.replace(/[^a-z]/gi, '')}.pdf`, out);
      console.log(`\n[${tag}]`);
      console.log(`  images in output: ${res.imageCount}`);
      console.log(`  PII still readable in embedded image: ${JSON.stringify(res.survivedInImage)}`);
      console.log(`  region means (embedded image): ${JSON.stringify(res.regionMeans)}`);
      console.log(`  raw byte-scan hits: ${JSON.stringify(res.byteHits)}`);
      console.log(`  => ${res.pass ? 'TRUE DESTRUCTION' : 'FAIL (pixels/PII survive)'}`);
    }
  }
  await worker.terminate();
}

main();
