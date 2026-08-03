// Build a simple Latin PDF fixture with planted synthetic PII as REAL
// extractable text (base-14 Helvetica, WinAnsi/Latin simple font).
// Proves the redaction mechanism independent of any Hebrew/font/bidi issue.

import * as mupdf from 'mupdf';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PII } from './pii.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'fixtures', 'latin.pdf');

function buildContentStream(lines) {
  // 18pt Helvetica, one line per entry, top-down from y=720.
  let y = 720;
  const parts = ['BT', '/F1 18 Tf'];
  for (const line of lines) {
    // Escape PDF string special chars.
    const esc = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    parts.push(`1 0 0 1 72 ${y} Tm (${esc}) Tj`);
    y -= 40;
  }
  parts.push('ET');
  return parts.join('\n');
}

function main() {
  const doc = new mupdf.PDFDocument();
  const font = new mupdf.Font('Helvetica');
  const fontRef = doc.addSimpleFont(font, 'Latin');

  const p = PII.latin;
  const lines = [
    'CONFIDENTIAL - synthetic test fixture',
    `Name: ${p.name}`,
    `ID number: ${p.id}`,
    `Phone: ${p.phone}`,
    'End of document.',
  ];

  const resources = doc.newDictionary();
  const fonts = doc.newDictionary();
  fonts.put('F1', fontRef);
  resources.put('Font', fonts);

  const mediabox = [0, 0, 595, 842]; // A4 points
  const contents = buildContentStream(lines);
  const pageObj = doc.addPage(mediabox, 0, resources, contents);
  doc.insertPage(-1, pageObj);

  // Full, clean save for the source fixture (no incremental history).
  const buf = doc.saveToBuffer({ garbage: 'compact', compress: true });
  const fs = require('node:fs');
  fs.writeFileSync(OUT, buf.asUint8Array());
  console.log('wrote', OUT, buf.getLength(), 'bytes');
}

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
main();
