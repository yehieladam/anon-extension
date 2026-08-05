/**
 * OCR threshold calibration (Stage 1 / OCR-01) — Fable-directed robust runner.
 *
 * Per Fable: fully OFFLINE (local vendored tessdata + node_modules core — no CDN, no DNS), per-sample
 * JSONL checkpoint, 120s/sample watchdog, incremental one-line print, per-DOC invocation, smoke-first.
 * Never a blind background batch. All PII synthetic (fictional names, checksum-shaped IDs).
 *
 *   node --dns-result-order=ipv4first scripts/ocr-calibrate.mjs smoke   2>&1 | tee scripts/smoke.log
 *   node --dns-result-order=ipv4first scripts/ocr-calibrate.mjs 1       2>&1 | tee scripts/doc1.log
 *   ... 2, 3, 4 ...
 *   node scripts/ocr-calibrate.mjs merge   # reads the .jsonl files -> table + summary
 */
import { chromium } from "playwright";
import * as mupdf from "mupdf";
import { createWorker } from "tesseract.js";
import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const fontB64 = readFileSync(join(root, "web", "test-fixtures", "fonts", "Heebo-Regular.ttf")).toString("base64");
const TESSDATA = join(root, "web", "public", "vendor", "tessdata"); // vendored, offline

const DOCS = [
  { id: "d1-moshe", name: "משה כהן", pid: "123456709", phone: "052-1234567",
    lines: ["מסמך לדוגמה", "שם הלקוח: משה כהן", "תעודת זהות 123456709", "טלפון 052-1234567", "סוף."] },
  { id: "d2-yosef", name: "יוסף בן דוד", pid: "111111118", phone: "054-7654321",
    lines: ["חוזה התקשרות", "הצד השני: יוסף בן דוד", "מספר זהות 111111118", "נייד 054-7654321", "סוף."] },
  { id: "d3-nahum", name: "נחום פרץ", pid: "222222226", phone: "058-9998877",
    lines: ["כתב תביעה", "התובע נחום פרץ מבקש", "תעודת זהות 222222226", "טלפון 058-9998877", "סוף."] },
  { id: "d4-miriam", name: "מרים אלון", pid: "333333334", phone: "03-1234567",
    lines: ["מכתב רשמי", "לכבוד מרים אלון", "מספר זהות 333333334", "טלפון 03-1234567", "סוף."] },
];

// Phase B: fixed OCR_RENDER_DPI = 200 (Fable), vary REALISTIC source degradation (softened so tesseract
// completes). Low-source-res models a poor scan by rendering at 90 DPI (the render pipeline's floor).
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
const SMOKE = [CELLS[0], { dpi: 200, deg: { noise: 30, skewDeg: 2 }, tag: "combo" }];

// Failure-ramp (Fable): remodeled low-res (downscale source → upscale to 200) + escalating blur/low-res
// until recall breaks, so there's a real boundary at the 200-DPI regime to set the FLOOR against.
const RAMP = [
  { dpi: 200, deg: { lowResDpi: 90 }, tag: "lowres-90" }, // remodel recheck (was the artifact)
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

/** 3x3 box blur (~sigma 1) in place on an RGB (n-channel) pixel buffer. */
function boxBlur(px, w, h, ch) {
  const src = Uint8ClampedArray.from(px);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1)
      for (let c = 0; c < ch; c += 1) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy += 1)
          for (let dx = -1; dx <= 1; dx += 1) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < h && xx >= 0 && xx < w) {
              sum += src[(yy * w + xx) * ch + c];
              n += 1;
            }
          }
        px[(y * w + x) * ch + c] = Math.round(sum / n);
      }
}

/** Model a low-res SOURCE rendered at the fixed DPI: box-downsample by `factor`, then nearest-upsample
 * back to full dims (detail lost at the source resolution, presented at the product's 200-DPI size). */
function downup(px, w, h, ch, factor) {
  const sw = Math.max(1, Math.round(w / factor));
  const sh = Math.max(1, Math.round(h / factor));
  const sum = new Float64Array(sw * sh * ch);
  const cnt = new Float64Array(sw * sh);
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

function rasterize(pdfBytes, cell) {
  const doc = mupdf.PDFDocument.openDocument(pdfBytes, "application/pdf");
  const scale = cell.dpi / 72;
  let matrix = mupdf.Matrix.scale(scale, scale);
  if (cell.deg.skewDeg) matrix = mupdf.Matrix.concat(matrix, mupdf.Matrix.rotate(cell.deg.skewDeg));
  const pix = doc.loadPage(0).toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
  const w = pix.getWidth();
  const h = pix.getHeight();
  const ch = pix.getNumberOfComponents();
  const px = pix.getPixels();
  if (cell.deg.noise) {
    const rand = rng(cellSeed("noise", cell));
    for (let i = 0; i < px.length; i += 1) px[i] = Math.max(0, Math.min(255, px[i] + (rand() * 2 - 1) * cell.deg.noise));
  }
  for (let i = 0; i < (cell.deg.blur || 0); i += 1) boxBlur(px, w, h, ch);
  if (cell.deg.lowResDpi) downup(px, w, h, ch, OCR_RENDER_DPI / cell.deg.lowResDpi);
  // JPEG cell: hand tesseract the low-quality JPEG bytes directly (it decodes JPEG) — the q40 encoding
  // is the compression-artifact degradation; no re-decode to a pixmap needed.
  const png = cell.deg.jpeg ? new Uint8Array(pix.asJPEG(cell.deg.jpeg, false)) : new Uint8Array(pix.asPNG());
  return { png, w, h };
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}
const norm = (s) => (s || "").normalize("NFC").replace(/[‎‏‪-‮]/g, "").replace(/\s+/g, "");
function recallOf(text, doc) {
  const t = norm(text);
  const name = t.includes(norm(doc.name));
  const id = t.includes(doc.pid);
  const phone = t.includes(doc.phone.replace(/-/g, "")) || t.includes(doc.phone);
  return { name, id, phone, ok: name && id && phone };
}

async function makeWorker(langs = "heb+eng", whitelist = null) {
  // Offline: local vendored traineddata (gzip). node core comes from node_modules (offline).
  const worker = await createWorker(langs, 1, { langPath: TESSDATA, cachePath: mkdtempSync(join(tmpdir(), "tess-")), gzip: true });
  const params = { tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" };
  if (whitelist) params.tessedit_char_whitelist = whitelist;
  await worker.setParameters(params);
  return worker;
}

/** Phase A — DPI micro-probe: which render DPI reads the Hebrew name safely, and is eng the Latin-confusion source? */
async function probe() {
  const probeDocs = [DOCS[0], DOCS[2]]; // משה כהן, נחום פרץ — the glyphs that misfired to Latin
  const dpis = [110, 130, 150, 175, 200, 250, 300];
  console.log("=== Phase A: DPI sweep (clean, heb+eng, PSM6) ===");
  console.log("doc        dpi  meanConf recall  name-read");
  const worker = await makeWorker("heb+eng");
  for (const doc of probeDocs) {
    for (const dpi of dpis) {
      const { png } = rasterize(pdfCache(doc), { dpi, deg: {} });
      const r = await ocrWithWatchdog(worker, png);
      const rec = recallOf(r.text, doc);
      console.log(`${doc.id.padEnd(10)} ${String(dpi).padStart(3)}  ${String(+r.mean.toFixed(1)).padStart(8)}  ${`${rec.name ? "N" : "-"}${rec.id ? "I" : "-"}${rec.phone ? "P" : "-"}`}     ${rec.name ? "OK" : "MISS: " + norm(r.text).slice(20, 40)}`);
    }
  }
  await worker.terminate();

  console.log("\n=== Phase A controls @300 DPI (mechanism) ===");
  const hebOnly = await makeWorker("heb");
  const whitelisted = await makeWorker("heb+eng", "0123456789אבגדהוזחטיכךלמםנןסעפףצץקרשת\"'.:- ");
  for (const doc of probeDocs) {
    const { png } = rasterize(pdfCache(doc), { dpi: 300, deg: {} });
    for (const [tag, w] of [["heb-only", hebOnly], ["heb+eng+whitelist", whitelisted]]) {
      const r = await ocrWithWatchdog(w, png);
      const rec = recallOf(r.text, doc);
      console.log(`${doc.id} 300 ${tag.padEnd(18)} meanConf=${(+r.mean.toFixed(1))} name=${rec.name ? "OK" : "MISS"} read="${norm(r.text).slice(10, 34)}"`);
    }
  }
  await hebOnly.terminate();
  await whitelisted.terminate();
}

// Render each probe doc's PDF once, cached (probe re-uses across DPIs).
const _pdfCache = new Map();
function pdfCache(doc) {
  return _pdfCache.get(doc.id);
}

async function ocrWithWatchdog(worker, png) {
  let timer;
  const watchdog = new Promise((_, rej) => (timer = setTimeout(() => rej(new Error("WATCHDOG_120s")), 120_000)));
  try {
    const { data } = await Promise.race([worker.recognize(Buffer.from(png), {}, { blocks: true }), watchdog]);
    clearTimeout(timer);
    const words = (data.words ?? (data.blocks ?? []).flatMap((b) =>
      (b.paragraphs ?? []).flatMap((p) => (p.lines ?? []).flatMap((l) => l.words ?? [])))).filter((w) => (w.text ?? "").trim().length > 0);
    const mean = words.length ? words.reduce((s, w) => s + (w.confidence ?? 0), 0) / words.length : 0;
    const lowRatio = words.length ? words.filter((w) => (w.confidence ?? 0) < 60).length / words.length : 1;
    return { text: data.text ?? "", mean, lowRatio, wordCount: words.length };
  } finally {
    clearTimeout(timer);
  }
}

async function runCells(doc, cells, jsonlPath) {
  console.log(`# ${doc.id}: rendering PDF…`);
  const pdf = await renderPdf(doc);
  const gt = norm(doc.lines.join(" "));
  const worker = await makeWorker();
  console.log("sample                         words meanConf lowRatio charAcc recall ok/err   elapsed");
  for (const cell of cells) {
    const t0 = Date.now();
    const label = `${doc.id} ${String(cell.dpi).padStart(3)} ${cell.tag}`.padEnd(30);
    let row;
    try {
      const { png } = rasterize(pdf, cell);
      const r = await ocrWithWatchdog(worker, png);
      const rec = recallOf(r.text, doc);
      const charAcc = Math.max(0, 1 - levenshtein(norm(r.text), gt) / Math.max(gt.length, 1));
      row = { doc: doc.id, dpi: cell.dpi, deg: cell.tag, seed: cellSeed(doc.id, cell), state: "OK",
        words: r.wordCount, meanConf: +r.mean.toFixed(1), lowRatio: +r.lowRatio.toFixed(3),
        charAcc: +charAcc.toFixed(3), recall: `${rec.name ? "N" : "-"}${rec.id ? "I" : "-"}${rec.phone ? "P" : "-"}`, recallOk: rec.ok, _text: r.text };
    } catch (err) {
      row = { doc: doc.id, dpi: cell.dpi, deg: cell.tag, seed: cellSeed(doc.id, cell), state: "ERROR", error: String(err.message || err) };
    }
    appendFileSync(jsonlPath, JSON.stringify(row) + "\n");
    const el = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    if (row.state === "OK")
      console.log(`${label} ${String(row.words).padStart(5)} ${String(row.meanConf).padStart(8)} ${String(row.lowRatio).padStart(8)} ${String(row.charAcc).padStart(7)} ${row.recall.padStart(6)} ${row.recallOk ? "ok  " : "FAIL"}    ${el}`);
    else console.log(`${label} ERROR ${row.error}  ${el}`);
    if (process.env.SHOW_TEXT && row.state === "OK") console.log(`    OCR: ${norm(row._text || "")}`);
  }
  await worker.terminate();
}

function merge() {
  const rows = [];
  for (const doc of DOCS)
    for (const prefix of ["calib-", "calib-ramp-"]) {
      const p = join(here, `${prefix}${doc.id}.jsonl`);
      if (existsSync(p)) for (const line of readFileSync(p, "utf8").split("\n").filter(Boolean)) rows.push(JSON.parse(line));
    }
  const ok = rows.filter((r) => r.state === "OK");
  const errs = rows.filter((r) => r.state === "ERROR");
  const fails = ok.filter((r) => !r.recallOk);
  const passes = ok.filter((r) => r.recallOk);
  console.log(`\n=== MERGED: ${rows.length} rows (${ok.length} ok, ${errs.length} error) ===`);
  console.log(`recall-FAIL: ${fails.length}   pass: ${passes.length}`);
  console.log(`max(meanConf | FAIL) = ${fails.length ? Math.max(...fails.map((r) => r.meanConf)) : "n/a"}`);
  console.log(`min(meanConf | PASS) = ${passes.length ? Math.min(...passes.map((r) => r.meanConf)) : "n/a"}`);
  console.log(`max(lowRatio | PASS) = ${passes.length ? Math.max(...passes.map((r) => r.lowRatio)) : "n/a"}`);
  console.log("FAIL rows:");
  for (const r of fails) console.log(`  ${r.doc} ${r.dpi} ${r.deg} meanConf=${r.meanConf} lowRatio=${r.lowRatio} words=${r.words} recall=${r.recall}`);
  if (errs.length) { console.log("ERROR rows:"); for (const r of errs) console.log(`  ${r.doc} ${r.dpi} ${r.deg}: ${r.error}`); }
  writeFileSync(join(here, "ocr-calibration-merged.json"), JSON.stringify(rows, null, 2));
}

const arg = process.argv[2];
if (arg === "ramp") {
  for (const doc of DOCS) {
    const p = join(here, `calib-ramp-${doc.id}.jsonl`);
    writeFileSync(p, "");
    await runCells(doc, RAMP, p);
  }
} else if (arg === "probe") {
  for (const doc of [DOCS[0], DOCS[2]]) {
    console.log(`# rendering ${doc.id}…`);
    _pdfCache.set(doc.id, await renderPdf(doc));
  }
  await probe();
} else if (arg === "merge") {
  merge();
} else if (arg === "smoke") {
  const p = join(here, "calib-smoke.jsonl");
  writeFileSync(p, "");
  await runCells(DOCS[0], SMOKE, p);
} else {
  const idx = Number(arg);
  if (!idx || idx < 1 || idx > DOCS.length) throw new Error("usage: ocr-calibrate.mjs <smoke|1..4|merge>");
  const doc = DOCS[idx - 1];
  const p = join(here, `calib-${doc.id}.jsonl`);
  writeFileSync(p, "");
  await runCells(doc, CELLS, p);
}
