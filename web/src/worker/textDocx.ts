/**
 * Build a minimal, valid .docx from tokenized text — the "Word for AI" output. A redacted PDF is a
 * visual redaction (true removal, black boxes) with no placeholder tokens, so it can't be pasted into
 * an LLM and restored later. This wraps the anonymized text (which already carries [ID_1] … tokens
 * and a coherent restore key) in a plain Word document: the LLM can work with the tokens, and the
 * result restores through the existing docx restore-file path. Layout/logo are intentionally dropped —
 * this output is for the AI round-trip, not for archiving (the redacted PDF is that).
 *
 * No font embedding: a .docx stores text, not glyphs, so Word/Docs render Hebrew RTL natively. Each
 * line becomes a bidi paragraph so mixed Hebrew/token/number lines lay out correctly.
 */

/** Escape the three characters that are significant inside an XML text node. */
function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** One RTL paragraph per line; a blank line becomes an empty paragraph so spacing survives. */
function paragraph(line: string): string {
  if (line.length === 0) {
    return `<w:p><w:pPr><w:bidi/></w:pPr></w:p>`;
  }
  return `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
}

function documentXml(text: string): string {
  const body = text.split("\n").map(paragraph).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

/** Wrap tokenized text in a minimal .docx (restorable through the docx restore-file path). */
export async function buildTokenDocx(text: string): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", documentXml(text));
  return zip.generateAsync({ type: "uint8array" });
}
