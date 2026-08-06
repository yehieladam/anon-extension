/**
 * Vendor the tesseract.js runtime + Hebrew/English OCR traineddata into web/public/vendor so they are
 * served SAME-ORIGIN at runtime (constitution: zero external network, CSP connect-src 'self'). The
 * worker + core wasm are copied from node_modules; the traineddata is downloaded once from the
 * tessdata_best mirror at BUILD/setup time (never at runtime). The output is gitignored (like the NER
 * model) — run this in `prebuild` and in local setup.
 *
 * Windows/dev note: force IPv4 for the download (this machine has a dead IPv6 route to some CDNs).
 *   node --dns-result-order=ipv4first scripts/fetch-tesseract-assets.mjs
 */
import { setDefaultResultOrder } from "node:dns";
import { cpSync, mkdirSync, existsSync, statSync, createWriteStream, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

setDefaultResultOrder("ipv4first");

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vendor = join(root, "web", "public", "vendor", "tesseract");
const tessdata = join(root, "web", "public", "vendor", "tessdata");
mkdirSync(vendor, { recursive: true });
mkdirSync(tessdata, { recursive: true });

// 1. tesseract worker + core wasm (from node_modules) → same-origin /vendor/tesseract.
const CORE = join(root, "node_modules", "tesseract.js-core");
const DIST = join(root, "node_modules", "tesseract.js", "dist");
const copies = [
  [join(DIST, "worker.min.js"), join(vendor, "worker.min.js")],
  [join(CORE, "tesseract-core-simd-lstm.wasm"), join(vendor, "tesseract-core-simd-lstm.wasm")],
  [join(CORE, "tesseract-core-simd-lstm.wasm.js"), join(vendor, "tesseract-core-simd-lstm.wasm.js")],
  [join(CORE, "tesseract-core-lstm.wasm"), join(vendor, "tesseract-core-lstm.wasm")],
  [join(CORE, "tesseract-core-lstm.wasm.js"), join(vendor, "tesseract-core-lstm.wasm.js")],
];
for (const [from, to] of copies) {
  cpSync(from, to);
  console.log(`copied ${to.replace(root, ".")}  ${statSync(to).size} bytes`);
}

// 2. Hebrew + English traineddata (tessdata_best) → same-origin /vendor/tessdata.
const MIRROR = "https://tessdata.projectnaptha.com/4.0.0_best";
for (const lang of ["heb", "eng"]) {
  const out = join(tessdata, `${lang}.traineddata.gz`);
  if (existsSync(out) && statSync(out).size > 0) {
    console.log(`have ${lang}.traineddata.gz`);
    continue;
  }
  const res = await fetch(`${MIRROR}/${lang}.traineddata.gz`);
  if (!res.ok || !res.body) {
    throw new Error(`download ${lang} failed: ${res.status}`);
  }
  // Stream to a .part file and rename only on success — so an interrupted download never leaves a
  // truncated .gz that the size>0 guard above would treat as complete forever (a silent broken vendor).
  const part = `${out}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
    renameSync(part, out);
  } catch (error) {
    if (existsSync(part)) rmSync(part);
    throw error;
  }
  console.log(`downloaded ${lang}.traineddata.gz  ${statSync(out).size} bytes`);
}
console.log("tesseract assets vendored.");
