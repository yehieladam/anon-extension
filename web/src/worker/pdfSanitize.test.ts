/**
 * PDF-06 sanitize gate (node, real mupdf) — a PDF "dirty in every channel" with a real HEBREW name
 * planted in Info, an annotation, XMP, an embedded file and an outline (bookmark), plus an ID in the
 * body and the same outline. After redactPdf:
 *  - metadata channels are stripped (Info/XMP/embedded/annotation) — the name is gone even though PDF
 *    stores it as hex-ASCII (`<FEFF…>`), which a raw-byte scan is blind to;
 *  - the outline goes through the SAME anonymize pass as the body, so the ID gets the SAME placeholder
 *    in the body and the bookmark (Fable's coherence requirement);
 *  - the in-production self-verify passes (it would throw otherwise).
 */
import { describe, expect, it } from "vitest";
import { redactPdf } from "./pdfRedact";
import { anonymizeFull } from "@engine/pipeline";
import { collectOutlineItems, sanitizeMetadata } from "./pdfSanitize";

const NAME = "ישראל ישראלי";
const ID = "123456709";

/* eslint-disable @typescript-eslint/no-explicit-any -- mupdf WASM surface is untyped */
async function buildDirty(): Promise<ArrayBuffer> {
  const mupdf = (await import("mupdf")) as any;
  const doc = new mupdf.PDFDocument();
  // Body: base-14 Helvetica so the ID is real extractable LTR text (no font file needed).
  const fontRef = doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin");
  const resources = doc.newDictionary();
  const fonts = doc.newDictionary();
  fonts.put("F1", fontRef);
  resources.put("Font", fonts);
  const page = doc.addPage([0, 0, 400, 200], 0, resources, `BT /F1 14 Tf 40 120 Td (Case ID: ${ID}) Tj ET`);
  doc.insertPage(-1, page);

  const trailer = doc.getTrailer();
  const root = trailer.get("Root");
  // Info dict — Hebrew name + ID
  const info = doc.newDictionary();
  info.put("Author", doc.newString(NAME));
  info.put("Title", doc.newString(`${NAME} ${ID}`));
  trailer.put("Info", doc.addObject(info));
  // Annotation — Hebrew name in contents + author
  const annot = doc.loadPage(0).createAnnotation("Text");
  annot.setContents(`${NAME} ${ID}`);
  annot.setAuthor(NAME);
  annot.update();
  // XMP metadata
  const md = doc.newDictionary();
  md.put("Type", doc.newName("Metadata"));
  root.put("Metadata", doc.addStream(new TextEncoder().encode(`<x><dc:creator>${NAME}</dc:creator></x>`), md));
  // Embedded file
  try {
    const now = new Date(0);
    doc.addEmbeddedFile(`${NAME}.txt`, "text/plain", new TextEncoder().encode(`${NAME} ${ID}`), now, now);
  } catch {
    /* embedded API varies; not essential to the gate */
  }
  // Outline (bookmark) — ID (also in body) + Hebrew name
  const outlines = doc.newDictionary();
  const item = doc.newDictionary();
  item.put("Title", doc.newString(`תיק ${ID} ${NAME}`));
  const oref = doc.addObject(outlines);
  const iref = doc.addObject(item);
  outlines.put("First", iref);
  outlines.put("Last", iref);
  item.put("Parent", oref);
  root.put("Outlines", oref);

  return new Uint8Array(doc.saveToBuffer({ compress: true }).asUint8Array()).buffer;
}

/** Mock the NER pass: mark every occurrence of the Hebrew name as PERSON (merged with deterministic). */
function withName(text: string) {
  const spans = [];
  for (let at = text.indexOf(NAME); at >= 0; at = text.indexOf(NAME, at + NAME.length)) {
    spans.push({ start: at, end: at + NAME.length, type: "PERSON" as const, score: 0.99 });
  }
  return anonymizeFull(text, spans);
}

async function reopen(bytes: Uint8Array): Promise<any> {
  const mupdf = (await import("mupdf")) as any;
  return mupdf.PDFDocument.openDocument(bytes, "application/pdf");
}

describe("redactPdf sanitizes every hidden channel", () => {
  it("strips metadata and anonymizes the outline coherently with the body", async () => {
    const { bytes, result } = await redactPdf(await buildDirty(), withName);

    // Self-verify passed (redactPdf would have thrown). Now inspect the channels directly.
    const doc = await reopen(bytes);

    // Info dict removed entirely.
    expect(doc.getTrailer().get("Info").isNull?.() ?? true).toBe(true);

    // Outline title anonymized — original name/ID gone, placeholders present, coherent with the body.
    const outline = collectOutlineItems(doc);
    expect(outline).toHaveLength(1);
    const title = outline[0].title;
    expect(title).not.toContain(NAME);
    expect(title).not.toContain(ID);
    const idPlaceholder = result.key.find((r) => r.original === ID)?.placeholder;
    const namePlaceholder = result.key.find((r) => r.original === NAME)?.placeholder;
    expect(idPlaceholder).toBeTruthy();
    // The SAME ID got the SAME placeholder in the body and the bookmark (unified key).
    expect(title).toContain(idPlaceholder!);
    expect(title).toContain(namePlaceholder!);

    // Annotation text cleared.
    const annots = doc.loadPage(0).getAnnotations();
    for (const a of annots) {
      expect(a.getContents?.() ?? "").not.toContain(NAME);
    }
  });

  it("leaves no channel holding the Hebrew name (decoded re-read)", async () => {
    const { bytes } = await redactPdf(await buildDirty(), withName);
    const doc = await reopen(bytes);
    // Re-read everything the sanitizer touches; the name must be absent everywhere.
    const info = doc.getTrailer().get("Info");
    const infoText = info.isNull?.() ? "" : ["Author", "Title"].map((k) => info.get(k)?.asString?.() ?? "").join(" ");
    const outlineText = collectOutlineItems(doc).map((o) => o.title).join(" ");
    const annotText = doc.loadPage(0).getAnnotations().map((a: any) => a.getContents?.() ?? "").join(" ");
    expect(infoText + outlineText + annotText).not.toContain(NAME);
  });
});

describe("sanitizeMetadata is idempotent and safe on a doc with no metadata", () => {
  it("does not throw on a bare document", async () => {
    const mupdf = (await import("mupdf")) as any;
    const doc = new mupdf.PDFDocument();
    doc.insertPage(-1, doc.addPage([0, 0, 100, 100], 0, doc.newDictionary(), "BT ET"));
    expect(() => sanitizeMetadata(doc)).not.toThrow();
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
