// Proves WHICH save options achieve TRUE byte-level removal. Shows that a
// non-incremental full rewrite ALONE is not enough — garbage collection is
// required to drop the orphaned pre-redaction object.
import * as mupdf from 'mupdf';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { markRedactions, applyAll } from './redact.mjs';
import { runThreeLayer } from './acceptance.mjs';
import { piiStrings } from './pii.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(join(here, '..', 'fixtures', 'latin.pdf'));
const needles = piiStrings('latin');

const options = [
  { incremental: true },
  {},
  { compress: true },
  { garbage: 'compact' },
  { garbage: 'compact', compress: true, sanitize: true },
  { garbage: 'deduplicate', compress: true, sanitize: true },
];

console.log('=== SAVE-OPTIONS MATRIX (latin fixture) ===');
console.log('opt                                              | A    | B    | C    | EOF | verdict');
for (const opt of options) {
  const doc = mupdf.PDFDocument.openDocument(src, 'application/pdf');
  markRedactions(doc, needles);
  applyAll(doc);
  const bytes = doc.saveToBuffer(opt).asUint8Array();
  const r = runThreeLayer(bytes, needles, needles);
  const label = JSON.stringify(opt).padEnd(48);
  const v = r.pass ? 'TRUE REMOVAL' : 'LEAKS';
  console.log(
    `${label} | ${r.a.pass ? 'PASS' : 'FAIL'} | ${r.b.pass ? 'PASS' : 'FAIL'} | ${r.c.pass ? 'PASS' : 'FAIL'} | ${String(r.c.eofCount).padStart(3)} | ${v}`
  );
}
