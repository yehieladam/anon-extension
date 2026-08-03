// Build a Hebrew PDF fixture with planted synthetic PII as REAL extractable
// text. Uses an embedded Type0/Identity-H font (Arial has Hebrew glyphs) via
// addFont; the content stream emits glyph IDs (CID==GID under Identity-H).
//
// NOTE: glyphs are placed in LOGICAL order left-to-right. Visual RTL shaping
// is deliberately out of scope for PDF-01 (that is the PDF-03 bidi problem).
// The only requirements here: text is extractable, findable via search(),
// and removable via applyRedactions().
import * as mupdf from 'mupdf';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PII } from './pii.mjs';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'fixtures', 'hebrew.pdf');
const ARIAL = process.env.HEB_FONT || 'C:/Windows/Fonts/arial.ttf';

// Emit a Tj show-op for one string as 2-byte glyph IDs (Identity-H).
function showGlyphs(font, text) {
  let hex = '';
  for (const ch of text) {
    const gid = font.encodeCharacter(ch.codePointAt(0));
    hex += gid.toString(16).padStart(4, '0');
  }
  return `<${hex}> Tj`;
}

function buildContentStream(font, lines) {
  let y = 720;
  const parts = ['BT', '/F1 18 Tf'];
  for (const line of lines) {
    parts.push(`1 0 0 1 72 ${y} Tm ${showGlyphs(font, line)}`);
    y -= 40;
  }
  parts.push('ET');
  return parts.join('\n');
}

function main() {
  if (!fs.existsSync(ARIAL)) {
    throw new Error(`Hebrew-capable font not found at ${ARIAL} (set HEB_FONT)`);
  }
  const doc = new mupdf.PDFDocument();
  const fontData = fs.readFileSync(ARIAL);
  const font = new mupdf.Font('Arial', fontData);
  const fontRef = doc.addFont(font); // Type0 Identity-H, ToUnicode generated

  const p = PII.hebrew;
  const lines = [
    'CONFIDENTIAL - synthetic Hebrew fixture',
    `${p.name}`, // Hebrew name alone (findable target)
    `ID: ${p.id}`,
    `Phone: ${p.phone}`,
    'End.',
  ];

  const resources = doc.newDictionary();
  const fonts = doc.newDictionary();
  fonts.put('F1', fontRef);
  resources.put('Font', fonts);

  const mediabox = [0, 0, 595, 842];
  const contents = buildContentStream(font, lines);
  const pageObj = doc.addPage(mediabox, 0, resources, contents);
  doc.insertPage(-1, pageObj);

  const buf = doc.saveToBuffer({ garbage: 'compact', compress: true });
  fs.writeFileSync(OUT, buf.asUint8Array());
  console.log('wrote', OUT, buf.getLength(), 'bytes');
}

main();
