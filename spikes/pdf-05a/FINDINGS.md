# PDF-05a — scanned-PDF (image) redaction + Hebrew OCR feasibility

Throwaway spike. Verdict: **GO for scanned redaction in v1.** All PII synthetic. mupdf 1.28.0,
tesseract.js 5.x. Runs in Node. (This FINDINGS.md was written post-hoc: the driving agent stalled on
an API error mid-stream; results were reproduced by running the committed scripts directly.)

## 1. Native image-pixel redaction WORKS (corrects PDF-01)

PDF-01 concluded `REDACT_IMAGE_PIXELS` "did not erase pixels" — that was a fixture/method artifact. On a
real single-raster scanned page it works exactly as needed:

- `page.applyRedactions(true, REDACT_IMAGE_PIXELS, REDACT_LINE_ART_NONE, REDACT_TEXT_REMOVE)` with the
  **PII rects** → output keeps the page image (**images: 1**) but the covered pixels are set to white
  (region means go `[224,224,224]/[212,212,212] → [255,255,255]`); OCR of the region finds nothing;
  raw-byte scan clean → **TRUE DESTRUCTION** of only the PII regions, rest of the scan intact.
- Save with the proven safe options `{garbage:"deduplicate", compress:true, sanitize:true}`.
- `REDACT_IMAGE_REMOVE` deletes the ENTIRE image (images: 0 → blank page) — do NOT use for scans.
- `page.update()` first vs not: no difference here. Whole-page rect also destroys (images: 0), expected.

Fallback (rasterize page → paint opaque box → re-embed) also produced a clean redacted PDF, kept as a
backup path, but the native method is preferred (simpler, stays in WASM, preserves the rest of the scan).

**Snippet for PDF-05 to copy:**
```js
// rects = PII bounding boxes in PDF page coords (from OCR word boxes mapped to page space)
for (const r of rects) { const a = page.createAnnotation("Redact"); a.setRect(r); a.update(); }
page.applyRedactions(true, PDFPage.REDACT_IMAGE_PIXELS, PDFPage.REDACT_LINE_ART_NONE, PDFPage.REDACT_TEXT_REMOVE);
const bytes = doc.saveToBuffer({ garbage: "deduplicate", compress: true, sanitize: true }).asUint8Array();
```

## 2. Hebrew OCR (tessdata_best `heb`+`eng`, PSM 6)

| scan | meanConf | char acc | PII recovered |
|------|----------|----------|---------------|
| 150 DPI clean | 91 | 96.6% | name, id, phone (all) |
| 300 DPI clean | 91 | 96.6% | name, id, phone (all) |
| 150 DPI noisy+skew | 89 | 95.8% | id, phone — **MISSED the name** |

- **`eng` traineddata is required alongside `heb`** for reliable digits (Israeli ID/phone) — +14.69 MiB.
- Added download weight: tesseract core wasm 2.73 MiB + `heb` 3.53 MiB + `eng` 14.69 MiB ≈ **21 MiB**
  (on top of the 185 MB NER model). Acceptable, but lazy-load only when a scan is processed (P0I-02).

## 3. The one risk that matters

**A noisy scan silently missed a name → that is a PII leak under our own promise.** OCR recall is not
100% and degrades with scan quality. Therefore **OCR-03 (per-word confidence surfacing + refuse below a
measured threshold) is mandatory, not optional** — a low-quality scan must produce "we cannot reliably
redact this scan," never a partial/silent redaction. OCR-01 must set that threshold from a real
synthetic-scan corpus with planted PII (char accuracy AND end-to-end PII recall per DPI/quality tier).

## Recommendation

Ship scanned OCR in v1 (feasible + proven), **gated on OCR-03 honesty/refusal**. Method: native
`REDACT_IMAGE_PIXELS` + PII rects + garbage save. Load `heb`+`eng` + tesseract only on scan use.

## Reproduce
```
cd spikes/pdf-05a
npm i
npm run spike        # build fixtures, native redact, fallback redact, OCR bench
# or individually: npm run spike:native | spike:fallback | spike:ocr
```
