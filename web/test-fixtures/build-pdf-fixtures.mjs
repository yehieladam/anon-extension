/**
 * Build the PDF test fixtures with planted SYNTHETIC PII (fictional). Ported from
 * spikes/pdf-01/src/build-{hebrew,latin}.mjs — glyphs are placed in LOGICAL order; the visual RTL
 * reversal is applied by mupdf on EXTRACTION (proven in the spike), so a logical-order fixture already
 * exercises the PDF-03 bidi problem. Do NOT reverse runs here (that would double-reverse).
 *
 * Fixtures are gitignored and regenerated in pretest / CI. The Hebrew font is the committed OFL Heebo
 * (covers Hebrew + Latin digits — our PII carries IDs/phones).
 *
 * Run: node web/test-fixtures/build-pdf-fixtures.mjs
 */
import * as mupdf from "mupdf";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const fs = require("node:fs");
const here = dirname(fileURLToPath(import.meta.url));
const HEEBO = join(here, "fonts", "Heebo-Regular.ttf");

// Synthetic, fictional. IDs are checksum-VALID so the real engine detects them.
const PII = {
  name: "ישראל ישראלי",
  id: "123456709", // valid Israeli-ID Luhn (synthetic)
  phone: "052-1234567",
};

/** Emit a Tj show-op for one string as 2-byte glyph IDs (Identity-H). */
function showGlyphs(font, text) {
  let hex = "";
  for (const ch of text) {
    hex += font.encodeCharacter(ch.codePointAt(0)).toString(16).padStart(4, "0");
  }
  return `<${hex}> Tj`;
}

function hebrewContentStream(font, lines) {
  let y = 780;
  const parts = ["BT", "/F1 18 Tf"];
  for (const line of lines) {
    parts.push(`1 0 0 1 72 ${y} Tm ${showGlyphs(font, line)}`);
    y -= 40;
  }
  parts.push("ET");
  return parts.join("\n");
}

function pageWith(doc, resources, contents) {
  const pageObj = doc.addPage([0, 0, 595, 842], 0, resources, contents);
  doc.insertPage(-1, pageObj);
}

function buildHebrew() {
  const font = new mupdf.Font("Heebo", fs.readFileSync(HEEBO));
  const doc = new mupdf.PDFDocument();
  const fontRef = doc.addFont(font); // Type0 Identity-H, ToUnicode generated

  const lines = [
    "CONFIDENTIAL - synthetic Hebrew fixture",
    PII.name, // Hebrew name alone
    // Mixed Hebrew + digits on ONE line: breaks a naive per-LINE reversal (digits must NOT reverse).
    `לקוח ${PII.name} מספר ${PII.id}`,
    // Phone split by a SOFT HYPHEN (U+00AD): the normalizer must still catch it.
    `טלפון ${PII.phone.replace("-", "­")}`,
    "End.",
  ];

  const resources = doc.newDictionary();
  const fonts = doc.newDictionary();
  fonts.put("F1", fontRef);
  resources.put("Font", fonts);

  pageWith(doc, resources, hebrewContentStream(font, lines));
  const out = join(here, "hebrew.pdf");
  fs.writeFileSync(out, doc.saveToBuffer({ garbage: "compact", compress: true }).asUint8Array());
  console.log("wrote", out);
}

function latinContentStream(lines) {
  let y = 720;
  const parts = ["BT", "/F1 18 Tf"];
  for (const line of lines) {
    const esc = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    parts.push(`1 0 0 1 72 ${y} Tm (${esc}) Tj`);
    y -= 40;
  }
  parts.push("ET");
  return parts.join("\n");
}

function buildLatin() {
  const doc = new mupdf.PDFDocument();
  const fontRef = doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin");
  const lines = [
    "CONFIDENTIAL - synthetic test fixture",
    "Name: John Smith",
    `ID number: ${PII.id}`,
    `Phone: ${PII.phone}`,
    "End of document.",
  ];
  const resources = doc.newDictionary();
  const fonts = doc.newDictionary();
  fonts.put("F1", fontRef);
  resources.put("Font", fonts);
  pageWith(doc, resources, latinContentStream(lines));
  const out = join(here, "latin.pdf");
  fs.writeFileSync(out, doc.saveToBuffer({ garbage: "compact", compress: true }).asUint8Array());
  console.log("wrote", out);
}

buildHebrew();
buildLatin();
