/**
 * Build a PDF "dirty in every hidden channel" for the PDF-06 sanitize gate: a synthetic ID in the body
 * AND in an outline (bookmark), and a synthetic Hebrew name in the Info dict, an annotation and XMP.
 * After redaction the body/outline ID must carry the SAME placeholder (unified key) and every metadata
 * channel must be stripped. The ID path works with deterministic detection (no model), so this fixture
 * drives the CI browser gate; the Hebrew name lives only in stripped channels, so it is removed without
 * NER. Committed (build needs mupdf). Run: node web/test-fixtures/build-dirty-pdf.mjs
 */
import * as mupdf from "mupdf";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";

const NAME = "ישראל ישראלי"; // synthetic
const ID = "123456709"; // synthetic, checksum-valid
const here = dirname(fileURLToPath(import.meta.url));

const doc = new mupdf.PDFDocument();
const fontRef = doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin");
const resources = doc.newDictionary();
const fonts = doc.newDictionary();
fonts.put("F1", fontRef);
resources.put("Font", fonts);
doc.insertPage(-1, doc.addPage([0, 0, 400, 200], 0, resources, `BT /F1 14 Tf 40 120 Td (Case ID: ${ID}) Tj ET`));

const trailer = doc.getTrailer();
const root = trailer.get("Root");
const info = doc.newDictionary();
info.put("Author", doc.newString(NAME));
info.put("Title", doc.newString(`${NAME} ${ID}`));
trailer.put("Info", doc.addObject(info));

const annot = doc.loadPage(0).createAnnotation("Text");
annot.setContents(`${NAME} ${ID}`);
annot.setAuthor(NAME);
annot.update();

const md = doc.newDictionary();
md.put("Type", doc.newName("Metadata"));
root.put("Metadata", doc.addStream(new TextEncoder().encode(`<x><dc:creator>${NAME}</dc:creator></x>`), md));

const outlines = doc.newDictionary();
const item = doc.newDictionary();
item.put("Title", doc.newString(`תיק ${ID} ${NAME}`));
const oref = doc.addObject(outlines);
const iref = doc.addObject(item);
outlines.put("First", iref);
outlines.put("Last", iref);
item.put("Parent", oref);
root.put("Outlines", oref);

const out = join(here, "pdf", "dirty.pdf");
fs.mkdirSync(dirname(out), { recursive: true });
fs.writeFileSync(out, doc.saveToBuffer({ compress: true }).asUint8Array());
// eslint-disable-next-line no-console -- build-time tooling
console.log("wrote", out);
