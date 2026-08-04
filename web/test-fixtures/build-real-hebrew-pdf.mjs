/**
 * Build a REAL RTL-shaped Hebrew PDF fixture — the case users actually upload (a Word/Chrome export),
 * as opposed to build-pdf-fixtures.mjs which authors glyphs in logical order. Chromium's print-to-PDF
 * applies full HarfBuzz bidi shaping, so mupdf extracts it the way it extracts real documents. Heebo
 * is embedded as a data URI so the glyphs are identical on every machine (reproducible in CI).
 *
 * The committed PDF (web/test-fixtures/pdf/chromium-hebrew.pdf) is the source of truth for the PDF-03
 * mapping tests; this script regenerates it. PII is synthetic (fictional), IDs checksum-valid.
 *
 * Run: node web/test-fixtures/build-real-hebrew-pdf.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const fontB64 = fs.readFileSync(join(here, "fonts", "Heebo-Regular.ttf")).toString("base64");

const LINES = [
  "מסמך סודי לדוגמה",
  "שם הלקוח: ישראל ישראלי",
  "תעודת זהות 123456709",
  "טלפון 052-1234567",
  "לקוח ישראל ישראלי מספר 123456709",
  "סוף המסמך.",
];

const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<style>
@font-face{font-family:Heebo;src:url(data:font/ttf;base64,${fontB64}) format("truetype");}
body{font-family:Heebo;font-size:18px;direction:rtl;padding:48px;line-height:2;}
</style></head><body>${LINES.map((line) => `<p>${line}</p>`).join("")}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
const out = join(here, "pdf", "chromium-hebrew.pdf");
fs.mkdirSync(dirname(out), { recursive: true });
await page.pdf({ path: out, format: "A4", printBackground: true });
await browser.close();
// eslint-disable-next-line no-console -- build-time tooling
console.log("wrote", out, fs.statSync(out).size, "bytes");
