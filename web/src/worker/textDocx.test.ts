/**
 * "Word for AI" export: wrap tokenized text in a .docx and prove it round-trips — the tokens survive
 * as real text, and the file restores to its originals through the docx restore-file path. This is the
 * bridge that makes a redacted PDF usable with an LLM (the PDF itself is a visual redaction, no tokens).
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { anonymizeDeterministic } from "@engine/pipeline";
import { buildTokenDocx } from "./textDocx";
import { restoreFile } from "./restoreFile";

describe("buildTokenDocx", () => {
  it("produces a valid docx whose text carries the tokens", async () => {
    const result = anonymizeDeterministic("לקוח בטלפון 052-1234567 ותעודת זהות 123456709");
    const bytes = await buildTokenDocx(result.anonymizedText);

    const document = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    expect(document).toContain("[טלפון_1]");
    expect(document).toContain("[ת״ז_1]");
    expect(document).not.toContain("052-1234567");
  });

  it("round-trips: the exported Word restores to the original values with the key", async () => {
    const result = anonymizeDeterministic("טלפון 052-1234567, ת״ז 123456709");
    const bytes = await buildTokenDocx(result.anonymizedText);

    const restored = await restoreFile("ai.docx", bytes.buffer.slice(0) as ArrayBuffer, result.key);
    const restoredXml = await (await JSZip.loadAsync(restored.bytes))
      .file("word/document.xml")!
      .async("string");
    expect(restoredXml).toContain("052-1234567");
    expect(restoredXml).toContain("123456709");
    expect(restored.unmatched).toHaveLength(0);
  });

  it("preserves line breaks as separate paragraphs", async () => {
    const bytes = await buildTokenDocx("שורה ראשונה\nשורה שנייה");
    const document = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    expect(document.match(/<w:p>/g)?.length).toBe(2);
  });
});
