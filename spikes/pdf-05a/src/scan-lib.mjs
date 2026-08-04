// Shared helpers for the PDF-05a scanned-redaction spike:
//  - author a Hebrew text page with known PII rects,
//  - rasterize it (the "scan"),
//  - wrap a raster as an image-only PDF page,
//  - crop / sample / map coordinates, byte-scan, enumerate embedded images.
import * as mupdf from 'mupdf';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PII, toVisual } from './pii.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');
export const ARIAL = process.env.HEB_FONT || 'C:/Windows/Fonts/arial.ttf';

export const PAGE_W = 595;
export const PAGE_H = 842;
const FONT_SIZE = 22;
const MARGIN_X = 60;
const TOP = 760;
const LINE_GAP = 54;

// Sum of glyph advances (fraction of em) * fontSize => width in points.
function textWidth(font, text, fontSize) {
  let w = 0;
  for (const ch of text) {
    const gid = font.encodeCharacter(ch.codePointAt(0));
    w += font.advanceGlyph(gid) * fontSize;
  }
  return w;
}

// Emit a hex Tj op for `text` in the exact order given (caller supplies visual
// order for Hebrew). CID == GID under Identity-H.
function showGlyphs(font, text) {
  let hex = '';
  for (const ch of text) {
    hex += font.encodeCharacter(ch.codePointAt(0)).toString(16).padStart(4, '0');
  }
  return `<${hex}> Tj`;
}

// The page layout. `pii` marks which lines are the name / id targets so we can
// return their point-space rects (y-up, PDF origin bottom-left).
function layout() {
  return [
    { logical: 'הסכם שכירות דירה בין הצדדים', rtl: true, pii: null },
    { logical: PII.name, rtl: true, pii: 'name' },
    { logical: PII.id, rtl: false, pii: 'id' },
    { logical: 'בית משפט השלום בתל אביב', rtl: true, pii: null },
    { logical: PII.phone, rtl: false, pii: 'phone' },
    { logical: 'המסמך הזה הוא דוגמה סינתטית בלבד', rtl: true, pii: null },
  ];
}

// Build the Hebrew text PDF and the PII rects. Returns { doc, rects }.
export function buildTextDoc() {
  if (!fs.existsSync(ARIAL)) {
    throw new Error(`Hebrew-capable font not found at ${ARIAL} (set HEB_FONT)`);
  }
  const doc = new mupdf.PDFDocument();
  const font = new mupdf.Font('Arial', fs.readFileSync(ARIAL));
  const fontRef = doc.addFont(font);

  const parts = [
    '1 1 1 rg', `0 0 ${PAGE_W} ${PAGE_H} re f`, // white paper
    '0 0 0 rg', 'BT', `/F1 ${FONT_SIZE} Tf`,
  ];
  const rects = {};
  const lines = layout();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const baseline = TOP - i * LINE_GAP;
    const rendered = line.rtl ? toVisual(line.logical) : line.logical;
    const w = textWidth(font, rendered, FONT_SIZE);
    parts.push(`1 0 0 1 ${MARGIN_X} ${baseline} Tm ${showGlyphs(font, rendered)}`);
    if (line.pii) {
      rects[line.pii] = [
        MARGIN_X - 4,
        baseline - 0.32 * FONT_SIZE,
        MARGIN_X + w + 4,
        baseline + 0.94 * FONT_SIZE,
      ];
    }
  }
  parts.push('ET');

  const resources = doc.newDictionary();
  const fonts = doc.newDictionary();
  fonts.put('F1', fontRef);
  resources.put('Font', fonts);
  const pageObj = doc.addPage([0, 0, PAGE_W, PAGE_H], 0, resources, parts.join('\n'));
  doc.insertPage(-1, pageObj);
  return { doc, rects };
}

// Rasterize a doc's first page. `extraMatrix` (optional) is concatenated after
// the DPI scale (used to inject a skew for the noisy OCR fixture).
export function rasterize(doc, dpi, extraMatrix) {
  const s = dpi / 72;
  let m = mupdf.Matrix.scale(s, s);
  if (extraMatrix) m = mupdf.Matrix.concat(m, extraMatrix);
  const page = doc.loadPage(0);
  return page.toPixmap(m, mupdf.ColorSpace.DeviceRGB, false);
}

// Wrap a pixmap as a single-page image-only PDF (a synthetic "scan").
export function pixmapToImageOnlyPdf(pixmap, saveOptions) {
  const doc = new mupdf.PDFDocument();
  const img = new mupdf.Image(pixmap);
  const imgRef = doc.addImage(img);
  const resources = doc.newDictionary();
  const xobj = doc.newDictionary();
  xobj.put('Im1', imgRef);
  resources.put('XObject', xobj);
  const content = `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im1 Do Q`;
  const pageObj = doc.addPage([0, 0, PAGE_W, PAGE_H], 0, resources, content);
  doc.insertPage(-1, pageObj);
  if (saveOptions) {
    const bytes = doc.saveToBuffer(saveOptions).asUint8Array();
    return { doc, bytes };
  }
  return { doc };
}

// Convert a PDF y-up rect to MuPDF page space (origin top-left, y-DOWN) — the
// space annot.setRect() and applyRedactions expect. Getting this wrong places
// the redaction box in the wrong part of the page.
export function toMupdfRect(rect) {
  return [rect[0], PAGE_H - rect[3], rect[2], PAGE_H - rect[1]];
}

// Map a point-space rect (y-up) to top-down pixel coords at a given DPI.
export function rectToPixels(rect, dpi) {
  const s = dpi / 72;
  return {
    x0: Math.max(0, Math.floor(rect[0] * s)),
    y0: Math.max(0, Math.floor((PAGE_H - rect[3]) * s)),
    x1: Math.ceil(rect[2] * s),
    y1: Math.ceil((PAGE_H - rect[1]) * s),
  };
}

// Copy an axis-aligned region of an RGB pixmap into a fresh RGB pixmap.
export function cropRegion(pix, r) {
  const w = Math.min(r.x1, pix.getWidth()) - r.x0;
  const h = Math.min(r.y1, pix.getHeight()) - r.y0;
  const out = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  const src = pix.getPixels();
  const dst = out.getPixels();
  const sn = pix.getNumberOfComponents();
  const dn = out.getNumberOfComponents();
  const ss = pix.getStride();
  const ds = out.getStride();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const so = (r.y0 + y) * ss + (r.x0 + x) * sn;
      const dOff = y * ds + x * dn;
      dst[dOff] = src[so];
      dst[dOff + 1] = src[so + 1];
      dst[dOff + 2] = src[so + 2];
    }
  }
  return out;
}

// Mean RGB over a region of an RGB pixmap (used to detect a black box / change).
export function regionMean(pix, r) {
  const src = pix.getPixels();
  const n = pix.getNumberOfComponents();
  const stride = pix.getStride();
  let R = 0, G = 0, B = 0, count = 0;
  const yEnd = Math.min(r.y1, pix.getHeight());
  const xEnd = Math.min(r.x1, pix.getWidth());
  for (let y = r.y0; y < yEnd; y++) {
    for (let x = r.x0; x < xEnd; x++) {
      const o = y * stride + x * n;
      R += src[o]; G += src[o + 1]; B += src[o + 2]; count++;
    }
  }
  return count ? [Math.round(R / count), Math.round(G / count), Math.round(B / count)] : [null, null, null];
}

// Raw-byte scan for any needle in UTF-8, UTF-16LE, and reversed forms.
export function byteScan(bytes, needles) {
  const hay = Buffer.from(bytes);
  const found = [];
  for (const needle of needles) {
    const forms = new Set([needle, [...needle].reverse().join('')]);
    for (const form of forms) {
      if (hay.includes(Buffer.from(form, 'utf8'))) found.push(`${needle} (utf8)`);
      if (hay.includes(Buffer.from(form, 'utf16le'))) found.push(`${needle} (utf16le)`);
    }
  }
  return found;
}

// Enumerate every embedded image XObject in a PDF and return their pixmaps.
export function enumerateImages(doc) {
  const out = [];
  const total = doc.countObjects();
  for (let num = 1; num < total; num++) {
    let dict;
    try {
      dict = doc.newIndirect(num).resolve();
    } catch {
      continue;
    }
    if (!dict || !dict.isDictionary || !dict.isDictionary()) continue;
    // The stream flag lives on the indirect object, not the resolved dict, so
    // identify images by /Subtype /Image rather than isStream().
    const subtype = dict.get('Subtype');
    if (!subtype || (subtype.asName ? subtype.asName() : '') !== 'Image') continue;
    try {
      const img = doc.loadImage(doc.newIndirect(num));
      out.push({ num, pixmap: img.toPixmap() });
    } catch {
      /* not decodable as image */
    }
  }
  return out;
}

export function writeOut(name, bytesOrPixmap) {
  const p = join(ROOT, 'out', name);
  if (bytesOrPixmap instanceof Uint8Array) fs.writeFileSync(p, bytesOrPixmap);
  else fs.writeFileSync(p, bytesOrPixmap.asPNG());
  return p;
}
