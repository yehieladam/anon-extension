/**
 * Integration test for overlay redaction — builds a REAL .docx / .xlsx zip (with a media file that
 * stands in for a logo), redacts it, and asserts: PII is replaced with placeholders, the original PII
 * is gone, and every non-text part (the "logo") survives byte-for-byte. This is the proof of the core
 * promise: we overlay the original file, we do not regenerate it.
 *
 * Runs in node (jszip works there); the only browser-only piece is the download anchor in App.tsx.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { restore } from "@engine/restore";
import { redactDocx, redactXlsx } from "./officeRedact";

const LOGO_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);

/** A minimal docx whose phone is split across three `<w:t>` runs (as Word routinely does). */
async function buildDocx(): Promise<ArrayBuffer> {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">שם הלקוח בטלפון </w:t></w:r><w:r><w:t>052-</w:t></w:r><w:r><w:t>1234</w:t></w:r><w:r><w:t>567</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">ת&quot;ז 123456709 ודוא&quot;ל test@example.co.il</w:t></w:r></w:p>
  </w:body>
</w:document>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", document);
  zip.file("word/media/image1.png", LOGO_BYTES); // the "logo" — must be preserved untouched
  return zip.generateAsync({ type: "arraybuffer" });
}

/** A minimal xlsx with two shared strings, one carrying an Israeli ID. */
async function buildXlsx(): Promise<ArrayBuffer> {
  const shared = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
  <si><t>כותרת</t></si>
  <si><t>מספר זהות 123456709</t></si>
</sst>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("xl/sharedStrings.xml", shared);
  zip.file("xl/media/image1.png", LOGO_BYTES);
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("redactDocx", () => {
  it("overlays placeholders, drops the original PII, and preserves the logo", async () => {
    const { bytes, result } = await redactDocx(await buildDocx());

    const out = await JSZip.loadAsync(bytes);
    const document = await out.file("word/document.xml")!.async("string");

    // PII replaced with the Hebrew placeholders...
    expect(document).toContain("[טלפון_1]");
    expect(document).toContain("[ת״ז_1]");
    expect(document).toContain("[אימייל_1]");
    // ...and the raw values are gone (the phone even though it was split across three runs).
    expect(document).not.toContain("1234567");
    expect(document).not.toContain("123456709");
    expect(document).not.toContain("test@example.co.il");

    // The logo survives byte-for-byte — we overlaid, we did not rebuild.
    const logo = await out.file("word/media/image1.png")!.async("uint8array");
    expect(Array.from(logo)).toEqual(Array.from(LOGO_BYTES));

    // The key is coherent and restore reverses the concatenated stream exactly.
    expect(result.key.length).toBe(3);
    expect(restore(result.anonymizedText, result.key).restoredText).toContain("123456709");
  });
});

describe("redactXlsx", () => {
  it("overlays placeholders into shared strings and preserves other parts", async () => {
    const { bytes, result } = await redactXlsx(await buildXlsx());

    const out = await JSZip.loadAsync(bytes);
    const shared = await out.file("xl/sharedStrings.xml")!.async("string");

    expect(shared).toContain("[ת״ז_1]");
    expect(shared).not.toContain("123456709");
    expect(shared).toContain("כותרת"); // untouched string stays
    expect(result.key.length).toBe(1);

    const logo = await out.file("xl/media/image1.png")!.async("uint8array");
    expect(Array.from(logo)).toEqual(Array.from(LOGO_BYTES));
  });
});
