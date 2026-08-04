// Acceptance verification for a redacted SCAN. The subtle trap: with
// black_boxes=true, applyRedactions paints a black rectangle into the PAGE
// CONTENT even if the underlying image pixels survive — so rendering the page
// and seeing black proves NOTHING. True destruction is checked on the DECODED
// EMBEDDED IMAGE itself: crop its PII region and OCR it. If the PII pixels are
// still in the image XObject, redaction only drew a cosmetic overlay.
import * as mupdf from 'mupdf';
import { PII } from './pii.mjs';
import {
  PAGE_H, PAGE_W, cropRegion, regionMean, byteScan, enumerateImages,
} from './scan-lib.mjs';
import { ocrPng } from './ocr.mjs';

const NEEDLES = [PII.name, PII.id, PII.phone];

function norm(s) {
  return (s || '').replace(/\s+/g, '');
}

// Which planted PII strings appear in an OCR text (space-insensitive).
function piiHits(text) {
  const t = norm(text);
  const hits = [];
  if (t.includes(norm(PII.name))) hits.push('name');
  if (t.includes(norm(PII.id))) hits.push('id');
  if (t.includes(PII.phone.replace('-', '')) || t.includes(PII.phone)) hits.push('phone');
  return hits;
}

// Map a point-space rect (y-up) to top-down pixel coords for an image whose
// full extent covers the page and whose width is `imgW` px.
function rectToImagePixels(rect, imgW, imgH) {
  const sx = imgW / PAGE_W;
  const sy = imgH / PAGE_H;
  return {
    x0: Math.max(0, Math.floor(rect[0] * sx)),
    y0: Math.max(0, Math.floor((PAGE_H - rect[3]) * sy)),
    x1: Math.min(imgW, Math.ceil(rect[2] * sx)),
    y1: Math.min(imgH, Math.ceil((PAGE_H - rect[1]) * sy)),
  };
}

// The real destruction test: decode every embedded image and OCR the PII
// regions inside each. Returns the union of PII strings still readable in ANY
// embedded image, plus per-region mean colors.
export async function checkEmbeddedImages(doc, rects, worker) {
  const images = enumerateImages(doc);
  const result = { imageCount: images.length, survived: new Set(), regionMeans: {} };
  for (const { pixmap } of images) {
    const w = pixmap.getWidth();
    const h = pixmap.getHeight();
    for (const [key, rect] of Object.entries(rects)) {
      const r = rectToImagePixels(rect, w, h);
      if (r.x1 <= r.x0 || r.y1 <= r.y0) continue;
      const mean = regionMean(pixmap, r);
      result.regionMeans[key] = mean;
      const crop = cropRegion(pixmap, r);
      const { text } = await ocrPng(worker, crop.asPNG());
      for (const hit of piiHits(text)) {
        if (hit === key || (key === 'id' && hit === 'id') || (key === 'name' && hit === 'name')) {
          result.survived.add(key);
        }
      }
    }
  }
  return result;
}

// Full acceptance for a redacted scan given its output bytes.
export async function acceptScan(bytes, rects, worker) {
  const safeBytes = Uint8Array.from(bytes); // detach from any live WASM view
  const doc = mupdf.PDFDocument.openDocument(safeBytes, 'application/pdf');

  const img = await checkEmbeddedImages(doc, rects, worker);
  const byteHits = byteScan(safeBytes, NEEDLES);

  const pass = img.survived.size === 0 && byteHits.length === 0;
  return {
    pass,
    survivedInImage: [...img.survived],
    imageCount: img.imageCount,
    regionMeans: img.regionMeans,
    byteHits,
  };
}
