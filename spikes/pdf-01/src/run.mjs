// End-to-end spike runner for one fixture kind ("latin" | "hebrew").
// Redacts twice (incremental vs full-rewrite+garbage) and runs the
// 3-layer acceptance test on each, then renders the redacted output to
// confirm it still opens.
import * as mupdf from 'mupdf';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { piiStrings } from './pii.mjs';
import { markRedactions, applyAll, saveIncremental, saveFullRewrite, SAFE_SAVE_OPTIONS } from './redact.mjs';
import { runThreeLayer } from './acceptance.mjs';
import { extractAllText } from './extract.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function fmt(res) {
  const a = res.a.pass ? 'PASS' : `FAIL(found: ${res.a.found.join(', ')})`;
  const b = res.b.pass ? 'PASS' : `FAIL(hits: ${res.b.hits.join(' | ')})`;
  const c = res.c.pass ? 'PASS' : `FAIL(EOF=${res.c.eofCount}, startxref=${res.c.startxrefCount})`;
  return `  Layer A (text re-extract): ${a}\n  Layer B (raw-byte scan):  ${b}\n  Layer C (structure):      ${c}\n  => ${res.pass ? 'PASS' : 'FAIL'}`;
}

function renderCheck(bytes, tag) {
  try {
    const doc = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
    const page = doc.loadPage(0);
    const pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
    const png = pix.asPNG();
    fs.writeFileSync(join(root, 'out', `${tag}.png`), png);
    return `opens+renders (png ${png.length} B, ${pix.getWidth()}x${pix.getHeight()})`;
  } catch (e) {
    return `RENDER FAILED: ${e.message}`;
  }
}

function redactOnce(sourceBytes, needles, saveFn) {
  const doc = mupdf.PDFDocument.openDocument(sourceBytes, 'application/pdf');
  const t0 = performance.now();
  const { boxes, matched } = markRedactions(doc, needles);
  applyAll(doc);
  const bytes = saveFn(doc);
  const ms = performance.now() - t0;
  return { bytes, boxes, matched, ms, pages: doc.countPages() };
}

function main() {
  const kind = process.argv[2] || 'latin';
  const src = join(root, 'fixtures', `${kind}.pdf`);
  const sourceBytes = fs.readFileSync(src);
  const needles = piiStrings(kind);

  // What is actually stored/extractable in the source (Hebrew reorders RTL).
  const srcDoc = mupdf.PDFDocument.openDocument(sourceBytes, 'application/pdf');
  const srcText = extractAllText(srcDoc);

  console.log(`\n==================== ${kind.toUpperCase()} ====================`);
  console.log(`source: ${src} (${sourceBytes.length} B)`);
  console.log(`PII needles (planted): ${needles.join(' | ')}`);
  console.log(`source extracted text: ${JSON.stringify(srcText)}`);
  console.log(`SAFE save options: ${JSON.stringify(SAFE_SAVE_OPTIONS)}`);

  // Acceptance asserts absence of the planted forms AND whatever variant the
  // locator actually matched (the real stored representation).
  const probe = redactOnce(sourceBytes, needles, saveFullRewrite);
  // Layer A text needles: planted + full-length stored variants (>=4 chars).
  const textNeedles = [
    ...new Set([...needles, ...Object.values(probe.matched).flat().filter((v) => v.length >= 4)]),
  ];
  // Layer B byte needles: full planted values only (fragments false-positive).
  const byteNeedles = needles;
  console.log(`locator matched variants: ${JSON.stringify(probe.matched)}`);
  console.log(`Layer A needles: ${textNeedles.join(' | ')}`);
  console.log(`Layer B needles: ${byteNeedles.join(' | ')}`);

  // --- Incremental (expected to LEAK) ---
  const inc = redactOnce(sourceBytes, needles, saveIncremental);
  fs.writeFileSync(join(root, 'out', `${kind}-incremental.pdf`), inc.bytes);
  const incRes = runThreeLayer(inc.bytes, textNeedles, byteNeedles);
  console.log(`\n[INCREMENTAL save]  boxes=${inc.boxes}  pages=${inc.pages}  ${inc.ms.toFixed(1)} ms  size=${inc.bytes.length} B`);
  console.log(`  render: ${renderCheck(inc.bytes, `${kind}-incremental`)}`);
  console.log(fmt(incRes));

  // --- Full rewrite + garbage (expected SAFE) ---
  const full = redactOnce(sourceBytes, needles, saveFullRewrite);
  fs.writeFileSync(join(root, 'out', `${kind}-fullrewrite.pdf`), full.bytes);
  const fullRes = runThreeLayer(full.bytes, textNeedles, byteNeedles);
  const perPage = full.ms / Math.max(1, full.pages);
  console.log(`\n[FULL-REWRITE+garbage save]  boxes=${full.boxes}  pages=${full.pages}  ${full.ms.toFixed(1)} ms (${perPage.toFixed(1)} ms/page)  size=${full.bytes.length} B`);
  console.log(`  render: ${renderCheck(full.bytes, `${kind}-fullrewrite`)}`);
  console.log(fmt(fullRes));

  console.log(`\nVERDICT[${kind}]: incremental ${incRes.pass ? 'PASS' : 'LEAKS'} | full-rewrite ${fullRes.pass ? 'PASS' : 'LEAKS'}`);
  return { incRes, fullRes };
}

main();
