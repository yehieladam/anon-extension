/**
 * Q2 (Fable §3.4) — does image sharpness / effective resolution separate the type-(ii) confident
 * leaks (d2-yosef lowres-60/50: ID digits read as Hebrew letters, gate-invisible) from all PASSes?
 *
 * Metric: variance-of-Laplacian on the grayscale raster (classic focus/effective-resolution measure).
 * Low value = blurry / low effective resolution. Pure measurement, OFFLINE, no OCR, no network.
 * Rasterization mirrors ocr-calibrate.mjs EXACTLY (same downup/boxBlur/noise) so numbers line up with
 * the recorded corpus, which we join in for the PASS/FAIL + gate-tier per doc×deg.
 *
 *   node scripts/q2-sharpness.mjs
 */
import { chromium } from "playwright";
import * as mupdf from "mupdf";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const fontB64 = readFileSync(join(root, "web", "test-fixtures", "fonts", "Heebo-Regular.ttf")).toString("base64");

const DOCS = [
  { id: "d1-moshe", lines: ["מסמך לדוגמה", "שם הלקוח: משה כהן", "תעודת זהות 123456709", "טלפון 052-1234567", "סוף."] },
  { id: "d2-yosef", lines: ["חוזה התקשרות", "הצד השני: יוסף בן דוד", "מספר זהות 111111118", "נייד 054-7654321", "סוף."] },
  { id: "d3-nahum", lines: ["כתב תביעה", "התובע נחום פרץ מבקש", "תעודת זהות 222222226", "טלפון 058-9998877", "סוף."] },
  { id: "d4-miriam", lines: ["מכתב רשמי", "לכבוד מרים אלון", "מספר זהות 333333334", "טלפון 03-1234567", "סוף."] },
];

const OCR_RENDER_DPI = 200;
const CELLS = [
  { dpi: 200, deg: {}, tag: "clean" },
  { dpi: 200, deg: { noise: 15 }, tag: "noise-light" },
  { dpi: 200, deg: { noise: 30 }, tag: "noise-med" },
  { dpi: 200, deg: { skewDeg: 1.5 }, tag: "skew1.5" },
  { dpi: 200, deg: { skewDeg: 2, noise: 15 }, tag: "skew2+noise" },
  { dpi: 200, deg: { blur: 1 }, tag: "blur" },
  { dpi: 200, deg: { jpeg: 40 }, tag: "jpeg-q40" },
  { dpi: 90, deg: {}, tag: "low-source-res" },
];
const RAMP = [
  { dpi: 200, deg: { lowResDpi: 90 }, tag: "lowres-90" },
  { dpi: 200, deg: { blur: 2 }, tag: "blur-s1.5" },
  { dpi: 200, deg: { blur: 3 }, tag: "blur-s2.0" },
  { dpi: 200, deg: { blur: 4 }, tag: "blur-s2.5" },
  { dpi: 200, deg: { blur: 5 }, tag: "blur-s3.0" },
  { dpi: 200, deg: { lowResDpi: 75 }, tag: "lowres-75" },
  { dpi: 200, deg: { lowResDpi: 60 }, tag: "lowres-60" },
  { dpi: 200, deg: { lowResDpi: 50 }, tag: "lowres-50" },
];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function cellSeed(docId, cell) {
  const key = `${docId}|${cell.dpi}|${cell.tag}`;
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function boxBlur(px, w, h, ch) {
  const src = Uint8ClampedArray.from(px);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1)
      for (let c = 0; c < ch; c += 1) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy += 1)
          for (let dx = -1; dx <= 1; dx += 1) {
            const yy = y + dy, xx = x + dx;
            if (yy >= 0 && yy < h && xx >= 0 && xx < w) { sum += src[(yy * w + xx) * ch + c]; n += 1; }
          }
        px[(y * w + x) * ch + c] = Math.round(sum / n);
      }
}
function downup(px, w, h, ch, factor) {
  const sw = Math.max(1, Math.round(w / factor)), sh = Math.max(1, Math.round(h / factor));
  const sum = new Float64Array(sw * sh * ch), cnt = new Float64Array(sw * sh);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const si = Math.min(sh - 1, Math.floor(y / factor)) * sw + Math.min(sw - 1, Math.floor(x / factor));
      cnt[si] += 1;
      for (let c = 0; c < ch; c += 1) sum[si * ch + c] += px[(y * w + x) * ch + c];
    }
  for (let i = 0; i < sw * sh; i += 1) for (let c = 0; c < ch; c += 1) sum[i * ch + c] /= cnt[i] || 1;
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const si = Math.min(sh - 1, Math.floor(y / factor)) * sw + Math.min(sw - 1, Math.floor(x / factor));
      for (let c = 0; c < ch; c += 1) px[(y * w + x) * ch + c] = Math.round(sum[si * ch + c]);
    }
}

/** Rasterize + return grayscale buffer (post-degradation). JPEG cell: encode+decode to reflect artifacts. */
function rasterizeGray(pdfBytes, cell) {
  const doc = mupdf.PDFDocument.openDocument(pdfBytes, "application/pdf");
  const scale = cell.dpi / 72;
  let matrix = mupdf.Matrix.scale(scale, scale);
  if (cell.deg.skewDeg) matrix = mupdf.Matrix.concat(matrix, mupdf.Matrix.rotate(cell.deg.skewDeg));
  const pix = doc.loadPage(0).toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
  const w = pix.getWidth(), h = pix.getHeight(), ch = pix.getNumberOfComponents();
  const px = pix.getPixels();
  if (cell.deg.noise) {
    const rand = rng(cellSeed("noise", cell));
    for (let i = 0; i < px.length; i += 1) px[i] = Math.max(0, Math.min(255, px[i] + (rand() * 2 - 1) * cell.deg.noise));
  }
  for (let i = 0; i < (cell.deg.blur || 0); i += 1) boxBlur(px, w, h, ch);
  if (cell.deg.lowResDpi) downup(px, w, h, ch, OCR_RENDER_DPI / cell.deg.lowResDpi);
  const gray = new Float64Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    let s = 0;
    for (let c = 0; c < Math.min(3, ch); c += 1) s += px[i * ch + c];
    gray[i] = s / Math.min(3, ch);
  }
  return { gray, w, h };
}

/** Variance of the 4-neighbour Laplacian over the interior (normalized focus measure). */
function varLaplacian(gray, w, h) {
  const lap = [];
  for (let y = 1; y < h - 1; y += 1)
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      lap.push(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]);
    }
  let mean = 0;
  for (const v of lap) mean += v;
  mean /= lap.length;
  let varr = 0;
  for (const v of lap) varr += (v - mean) * (v - mean);
  return varr / lap.length;
}

async function renderPdf(doc) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<style>@font-face{font-family:Heebo;src:url(data:font/ttf;base64,${fontB64}) format("truetype");}
body{font-family:Heebo;font-size:18px;direction:rtl;padding:48px;line-height:2;}</style></head>
<body>${doc.lines.map((l) => `<p>${l}</p>`).join("")}</body></html>`;
  await page.setContent(html, { waitUntil: "networkidle" });
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  await browser.close();
  return pdf;
}

// Join key: doc + deg-tag. Recorded corpus lives in calib-*.jsonl. Recall/lowRatio drive PASS + tier.
function loadCorpus() {
  const map = new Map();
  for (const f of ["calib-d1-moshe", "calib-d2-yosef", "calib-d3-nahum", "calib-d4-miriam",
                   "calib-ramp-d1-moshe", "calib-ramp-d2-yosef", "calib-ramp-d3-nahum", "calib-ramp-d4-miriam"]) {
    const p = join(here, `${f}.jsonl`);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").trim().split("\n")) {
      const r = JSON.parse(line);
      map.set(`${r.doc}|${r.deg}`, r);
    }
  }
  return map;
}

const corpus = loadCorpus();
const rows = [];
for (const doc of DOCS) {
  const pdf = await renderPdf(doc);
  for (const cell of [...CELLS, ...RAMP]) {
    const { gray, w, h } = rasterizeGray(pdf, cell);
    const vlap = varLaplacian(gray, w, h);
    const rec = corpus.get(`${doc.id}|${cell.tag}`);
    const pass = rec ? rec.recallOk : null;
    const lowRatio = rec ? rec.lowRatio : null;
    const meanConf = rec ? rec.meanConf : null;
    const confident = lowRatio !== null && lowRatio <= 0.083; // gate-invisible tier
    rows.push({ doc: doc.id, deg: cell.tag, vlap, pass, meanConf, lowRatio, confident });
    console.log(`${doc.id.padEnd(10)} ${cell.tag.padEnd(14)} vLap=${vlap.toFixed(1).padStart(8)} ` +
      `pass=${pass === null ? "?" : pass ? "Y" : "N"} meanConf=${meanConf ?? "?"} lowRatio=${lowRatio ?? "?"}`);
  }
}

// Separation analysis: can a vLap floor reject the type-(ii) confident leaks without rejecting PASSes?
const passes = rows.filter((r) => r.pass === true);
const confidentFails = rows.filter((r) => r.pass === false && r.confident);
const unsureFails = rows.filter((r) => r.pass === false && !r.confident);
const minPassVlap = Math.min(...passes.map((r) => r.vlap));
const maxConfFailVlap = confidentFails.length ? Math.max(...confidentFails.map((r) => r.vlap)) : NaN;
console.log("\n=== Q2 SEPARATION (variance-of-Laplacian) ===");
console.log(`PASS vLap range: [${Math.min(...passes.map((r) => r.vlap)).toFixed(1)}, ${Math.max(...passes.map((r) => r.vlap)).toFixed(1)}]  (n=${passes.length})`);
console.log(`CONFIDENT FAIL vLap: ${confidentFails.map((r) => `${r.doc}/${r.deg}=${r.vlap.toFixed(1)}`).join(", ") || "(none)"}`);
console.log(`UNSURE FAIL vLap:    ${unsureFails.map((r) => `${r.doc}/${r.deg}=${r.vlap.toFixed(1)}`).join(", ") || "(none)"}`);
console.log(`\nmin(PASS)=${minPassVlap.toFixed(1)}   max(CONFIDENT-FAIL)=${Number.isNaN(maxConfFailVlap) ? "n/a" : maxConfFailVlap.toFixed(1)}`);
console.log(minPassVlap > maxConfFailVlap
  ? `SEPARABLE: a vLap floor in (${maxConfFailVlap.toFixed(1)}, ${minPassVlap.toFixed(1)}) rejects the confident leaks and passes all clean reads.`
  : `NOT separable by vLap alone: confident-fail vLap overlaps the PASS range.`);
