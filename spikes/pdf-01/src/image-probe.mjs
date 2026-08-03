// Probe REDACT_IMAGE_PIXELS on an embedded image, including a soft-masked
// (transparent) image — the class that historically segfaulted upstream
// PyMuPDF (issue #434). We build the fixture in-process, redact a rect over
// the image, and verify: (a) no crash, (b) the covered pixels are destroyed.
import * as mupdf from 'mupdf';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { saveFullRewrite } from './redact.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Build a WxH RGB pixmap with a recognisable pattern (colored bands).
function patternPixmap(w, h) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  const px = pix.getPixels();
  const n = pix.getNumberOfComponents();
  const stride = pix.getStride();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * stride + x * n;
      px[o] = (x * 255 / w) | 0; // R ramp
      px[o + 1] = (y * 255 / h) | 0; // G ramp
      px[o + 2] = 200; // B const
    }
  }
  return pix;
}

function grayMaskPixmap(w, h) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, w, h], false);
  const px = pix.getPixels();
  const stride = pix.getStride();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      px[y * stride + x] = (x * 255 / w) | 0; // horizontal alpha ramp
    }
  }
  return pix;
}

function buildImageFixture(withMask) {
  const doc = new mupdf.PDFDocument();
  const W = 240;
  const H = 120;
  const colorPix = patternPixmap(W, H);
  let img;
  if (withMask) {
    const maskImg = new mupdf.Image(grayMaskPixmap(W, H));
    img = new mupdf.Image(colorPix, maskImg); // soft-masked image
  } else {
    img = new mupdf.Image(colorPix);
  }
  const imgRef = doc.addImage(img);

  const resources = doc.newDictionary();
  const xobj = doc.newDictionary();
  xobj.put('Im1', imgRef);
  resources.put('XObject', xobj);

  // Place image at (72,600), scaled to 240x120 points.
  const content = `q 240 0 0 120 72 600 cm /Im1 Do Q`;
  const pageObj = doc.addPage([0, 0, 595, 842], 0, resources, content);
  doc.insertPage(-1, pageObj);
  return doc;
}

// Sample the rendered page at a point to prove pixels changed.
function samplePixel(bytesOrDoc, px, py) {
  const doc =
    bytesOrDoc instanceof Uint8Array
      ? mupdf.PDFDocument.openDocument(bytesOrDoc, 'application/pdf')
      : bytesOrDoc;
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
  const data = pix.getPixels();
  const o = py * pix.getStride() + px * pix.getNumberOfComponents();
  return [data[o], data[o + 1], data[o + 2]];
}

function probe(withMask) {
  const label = withMask ? 'soft-masked image (#434 class)' : 'plain RGB image';
  const doc = buildImageFixture(withMask);
  // A point inside the image region (page y is bottom-up; image spans y 600..720,
  // which in top-down pixels is ~122..242). Sample near center.
  const sx = 150;
  const syTopDown = 842 - 660; // ~182
  const before = samplePixel(doc, sx, syTopDown);

  // Redact a rect covering the middle of the image.
  const page = doc.loadPage(0);
  const annot = page.createAnnotation('Redact');
  annot.setRect([120, 630, 260, 700]);
  page.applyRedactions(true, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);

  const bytes = saveFullRewrite(doc);
  fs.writeFileSync(join(root, 'out', `image-${withMask ? 'masked' : 'plain'}.pdf`), bytes);
  const after = samplePixel(bytes, sx, syTopDown);
  const changed = before.join(',') !== after.join(',');
  console.log(`[${label}] no crash. sampled pixel before=${before} after=${after} changed=${changed}`);
  return { label, before, after, changed };
}

console.log('=== IMAGE-PIXEL REDACTION PROBE ===');
probe(false);
probe(true);
console.log('probe completed without segfault.');
