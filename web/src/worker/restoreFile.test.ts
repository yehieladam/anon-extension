/**
 * Restore-file round-trip (node, real JSZip): redact a .docx, then restore the redacted file with its
 * key and assert the original values are back and the placeholders are gone — the workflow of
 * redact → (AI edits the file) → restore, proven end to end without an AI in the loop.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { redactDocx } from "./officeRedact";
import { restoreFile, RESTORE_UNSUPPORTED } from "./restoreFile";
import { anonymizeDeterministic } from "@engine/pipeline";

async function buildDocx(): Promise<ArrayBuffer> {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">לקוח מספר 123456709 בטלפון 052-1234567</w:t></w:r></w:p>
  </w:body>
</w:document>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", document);
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("restoreFile — docx round-trip", () => {
  it("puts the original values back into a redacted docx", async () => {
    const { bytes: redacted, result } = await redactDocx(await buildDocx(), anonymizeDeterministic);

    // Sanity: the redacted docx holds placeholders, not the originals.
    const redactedDoc = await JSZip.loadAsync(redacted);
    const redactedXml = await redactedDoc.file("word/document.xml")!.async("string");
    expect(redactedXml).toContain("[ID_1]");
    expect(redactedXml).not.toContain("123456709");

    // Restore the redacted file with its key.
    const restored = await restoreFile("doc.docx", redacted.buffer.slice(0) as ArrayBuffer, result.key);
    const restoredDoc = await JSZip.loadAsync(restored.bytes);
    const restoredXml = await restoredDoc.file("word/document.xml")!.async("string");

    expect(restoredXml).toContain("123456709");
    expect(restoredXml).toContain("052-1234567");
    expect(restoredXml).not.toContain("[ID_1]");
    expect(restoredXml).not.toContain("[PHONE_1]");
    expect(restored.unmatched).toHaveLength(0);
  });

  it("restores a plain .txt file", async () => {
    const { bytes: redacted, result } = await redactDocx(await buildDocx(), anonymizeDeterministic);
    // Take the redacted text and restore it as a txt payload.
    const redactedDoc = await JSZip.loadAsync(redacted);
    const xml = await redactedDoc.file("word/document.xml")!.async("string");
    const placeholders = (xml.match(/\[[^\]]+_\d+\]/g) ?? []).join(" ");
    const buffer = new TextEncoder().encode(placeholders).buffer;
    const restored = await restoreFile("x.txt", buffer, result.key);
    expect(new TextDecoder().decode(restored.bytes)).toContain("123456709");
  });

  it("throws RESTORE_UNSUPPORTED for an unsupported type (e.g. pdf)", async () => {
    await expect(restoreFile("x.pdf", new ArrayBuffer(4), [])).rejects.toThrow(RESTORE_UNSUPPORTED);
  });
});
