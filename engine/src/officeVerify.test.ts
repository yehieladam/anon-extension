/**
 * Office self-verify scan — the fail-closed backstop. Proves it catches an original value in ANY text
 * part (including metadata), sees through XML-entity escaping and separator splitting, and never
 * false-positives on binary parts.
 */
import { describe, expect, it } from "vitest";
import { officeLeakScan } from "./officeVerify";

const ID = "123456709";

function parts(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe("officeLeakScan", () => {
  it("1. passes when no needle appears in any part", () => {
    const result = officeLeakScan(parts({ "word/document.xml": "<w:t>[ת״ז_1]</w:t>" }), [ID]);
    expect(result.pass).toBe(true);
    expect(result.hits).toEqual([]);
  });

  it("2. fails when a needle survives verbatim in a metadata part", () => {
    const result = officeLeakScan(
      parts({
        "word/document.xml": "<w:t>[ת״ז_1]</w:t>",
        "docProps/core.xml": `<dc:creator>${ID}</dc:creator>`,
      }),
      [ID],
    );
    expect(result.pass).toBe(false);
    expect(result.hits).toEqual([`docProps/core.xml: ${ID}`]);
  });

  it("3. catches an XML-entity-escaped needle (decode before scanning)", () => {
    const result = officeLeakScan(
      parts({ "docProps/core.xml": "<dc:creator>Cohen &amp; Levi</dc:creator>" }),
      ["Cohen & Levi"],
    );
    expect(result.pass).toBe(false);
  });

  it("4. catches a separator-split needle (normalize away spaces/hyphens)", () => {
    const result = officeLeakScan(parts({ "word/document.xml": "<w:t>123-456 709</w:t>" }), [ID]);
    expect(result.pass).toBe(false);
  });

  it("5. skips binary parts so digits in an image never false-positive", () => {
    const result = officeLeakScan(
      parts({ "word/media/image1.png": `PNGDATA${ID}MOREBYTES` }),
      [ID],
    );
    expect(result.pass).toBe(true);
    expect(result.hits).toEqual([]);
  });
});
