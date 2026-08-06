/**
 * Office metadata sanitizer (the office analogue of pdfSanitize). A redacted body is not enough: an
 * Office file carries names in metadata channels Word/Explorer surface — the author, the firm, revision
 * history, DMS custom properties, comment authors. These are data ABOUT the document, so a placeholder
 * is meaningless: we BLANK them. Comment BODY text is different — it is authored prose that can hold a
 * client name also in the body, so it is routed through the same detection pass in officeRedact (not
 * here), producing a coherent [NAME_N] that restores.
 *
 * We blank inner text / attribute values and never delete the element itself — an empty element
 * (`<dc:creator></dc:creator>`) is schema-valid, deleting it may not be. Blanking custom string
 * properties can drop DMS round-trip fields (matter id, client name); that is intended — those are
 * exactly the covert PII channels a legal tool must clear.
 *
 * Out of scope for now (left to the self-verify backstop, documented follow-up): xlsx threaded comments
 * (`xl/threadedComments/*`), which use a different `<text>` shape.
 */
import type JSZip from "jszip";

/** Blank the inner text of each named element: `<tag …>X</tag>` → `<tag …></tag>`. */
function blankElementText(xml: string, tags: readonly string[]): string {
  let out = xml;
  for (const tag of tags) {
    out = out.replace(new RegExp(`(<${tag}\\b[^>]*>)[\\s\\S]*?(</${tag}>)`, "g"), "$1$2");
  }
  return out;
}

/** Blank the value of each named attribute: `attr="X"` → `attr=""`. */
function blankAttr(xml: string, attrs: readonly string[]): string {
  let out = xml;
  for (const attr of attrs) {
    out = out.replace(new RegExp(`${attr}="[^"]*"`, "g"), `${attr}=""`);
  }
  return out;
}

/** Core document properties that name people/organisations or echo the content. Timestamps are kept. */
const CORE_TAGS = [
  "dc:creator",
  "cp:lastModifiedBy",
  "dc:title",
  "dc:subject",
  "dc:description",
  "cp:keywords",
  "cp:category",
  "cp:contentStatus",
] as const;

/** Extended app properties that carry the firm / manager. Structural props (Application…) are kept. */
const APP_TAGS = ["Company", "Manager"] as const;

/** Custom-property STRING values only — numeric/bool/date typed nodes must stay untouched (schema). */
const CUSTOM_STRING_TAGS = ["vt:lpwstr", "vt:bstr"] as const;

/** Apply `fn` to a part if it exists in the zip. */
async function editPart(zip: JSZip, path: string, fn: (xml: string) => string): Promise<void> {
  const file = zip.file(path);
  if (file) {
    zip.file(path, fn(await file.async("string")));
  }
}

/** Apply `fn` to every part whose name matches `pattern`. */
async function editMatching(zip: JSZip, pattern: RegExp, fn: (xml: string) => string): Promise<void> {
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir && pattern.test(name));
  for (const name of names) {
    zip.file(name, fn(await zip.files[name].async("string")));
  }
}

/**
 * Blank the metadata leak channels of an open docx/xlsx zip, in place. Comment BODY text is NOT touched
 * here (it goes through the redaction pass); only the comment AUTHOR metadata is blanked.
 */
export async function sanitizeOfficeMetadata(zip: JSZip): Promise<void> {
  await editPart(zip, "docProps/core.xml", (xml) => blankElementText(xml, CORE_TAGS));
  await editPart(zip, "docProps/app.xml", (xml) => blankElementText(xml, APP_TAGS));
  await editPart(zip, "docProps/custom.xml", (xml) => blankElementText(xml, CUSTOM_STRING_TAGS));
  await editMatching(zip, /^word\/comments\.xml$/, (xml) => blankAttr(xml, ["w:author", "w:initials"]));
  await editMatching(zip, /^xl\/comments\d*\.xml$/, (xml) => blankElementText(xml, ["author"]));
  await editMatching(zip, /^xl\/persons\/person\d*\.xml$/, (xml) => blankAttr(xml, ["displayName"]));
}
