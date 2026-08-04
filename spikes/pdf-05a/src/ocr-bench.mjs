// INVESTIGATION 4 (OCR-01 seed): Hebrew OCR reality on synthetic scans.
// OCR clean 150/300 DPI and a noisy+skewed 150 DPI page with tessdata_best
// heb+eng, then score character accuracy AND end-to-end PII recall (the number
// that actually gates scan redaction — every missed PII string is a leak).
import fs from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './scan-lib.mjs';
import { PII } from './pii.mjs';
import { makeWorker, ocrPng } from './ocr.mjs';

// Logical reading-order ground truth (what a Hebrew reader would type).
const GT_LINES = [
  'הסכם שכירות דירה בין הצדדים',
  PII.name,
  PII.id,
  'בית משפט השלום בתל אביב',
  PII.phone,
  'המסמך הזה הוא דוגמה סינתטית בלבד',
];

const BIDI = /[‎‏‪-‮⁦-⁩]/g;
function norm(s) {
  return (s || '').normalize('NFC').replace(BIDI, '').replace(/\s+/g, ' ').trim();
}
function stripSpaces(s) {
  return norm(s).replace(/\s+/g, '');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function charAccuracy(gt, ocr) {
  const g = norm(gt), o = norm(ocr);
  if (!g.length) return 0;
  return Math.max(0, 1 - levenshtein(g, o) / g.length);
}

// End-to-end PII recall: is each planted entity recoverable from OCR text?
// Space-insensitive (Hebrew OCR frequently drops inter-word spaces).
function piiRecall(ocr) {
  const flat = stripSpaces(ocr);
  return {
    name: flat.includes(stripSpaces(PII.name)),
    id: flat.includes(PII.id),
    phone: flat.includes(PII.phone.replace('-', '')) || flat.includes(PII.phone),
  };
}

const TIERS = [
  { label: '150 DPI clean', file: 'scan-150.png' },
  { label: '300 DPI clean', file: 'scan-300.png' },
  { label: '150 DPI noisy+skew', file: 'scan-150-noisy.png' },
];

function fmtPct(x) { return `${(x * 100).toFixed(1)}%`; }

function weightReport() {
  const core = join(ROOT, 'node_modules', 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm');
  const heb = join(ROOT, 'tessdata', 'heb.traineddata');
  const eng = join(ROOT, 'tessdata', 'eng.traineddata');
  const mib = (p) => (fs.existsSync(p) ? (fs.statSync(p).size / 1048576).toFixed(2) : '?');
  console.log('\n=== Added download weight (uncompressed on disk) ===');
  console.log(`  tesseract core wasm (simd-lstm): ${mib(core)} MiB`);
  console.log(`  heb.traineddata (tessdata_best): ${mib(heb)} MiB`);
  console.log(`  eng.traineddata (tessdata_best): ${mib(eng)} MiB  (needed for reliable digits)`);
}

async function main() {
  const gtFull = GT_LINES.join('\n');
  const worker = await makeWorker({ best: true, psm: '6', langs: 'heb+eng' });
  console.log('=== Hebrew OCR benchmark (tessdata_best heb+eng, PSM 6) ===');
  console.log('Ground truth PII:', JSON.stringify(PII));

  for (const tier of TIERS) {
    const png = fs.readFileSync(join(ROOT, 'out', tier.file));
    const { text, meanConf } = await ocrPng(worker, png);
    const acc = charAccuracy(gtFull, text);
    const recall = piiRecall(text);
    const recovered = Object.entries(recall).filter(([, v]) => v).map(([k]) => k);
    const missed = Object.entries(recall).filter(([, v]) => !v).map(([k]) => k);
    console.log(`\n--- ${tier.label} (${tier.file}) ---`);
    console.log(`  meanConf: ${meanConf}`);
    console.log(`  char accuracy: ${fmtPct(acc)}`);
    console.log(`  PII recovered: [${recovered.join(', ')}]  missed: [${missed.join(', ') || 'none'}]`);
    console.log(`  OCR text: ${JSON.stringify(norm(text))}`);
  }

  weightReport();
  await worker.terminate();
}

main();
