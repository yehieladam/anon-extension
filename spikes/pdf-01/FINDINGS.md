# PDF-01 — Feasibility spike: `mupdf` client-side PII redaction

**Status: GO (for the text-PDF pipeline).** Throwaway spike. Node 20, Windows, no server, no browser.

`mupdf` (WASM MuPDF) does **true content removal** of PII in a PDF, fully client-side, and the
non-negotiable **three-layer acceptance test passes** — **only** when the output is saved as a
**full rewrite with garbage collection**. Incremental save leaks recoverable PII, exactly as the
constitution warns.

One path is **NOT** proven: **image-pixel redaction did not take effect** on the synthetic image
fixture in this build (no crash, but pixels were not destroyed). This gates **PDF-05 (scanned/OCR
redaction)**, not the text pipeline (PDF-03/PDF-04). See section 6.

---

## 1. Environment / sizes

| Item | Value |
|---|---|
| `mupdf` version | **1.28.0** (installed via `npm i mupdf`) |
| License | **AGPL-3.0** (already the project decision — web app is AGPL) |
| WASM asset `dist/mupdf-wasm.wasm` | **10,408,550 B = 9.93 MiB** uncompressed |
| Brotli `dist/mupdf-wasm.wasm.br` | **3,609,152 B = 3.44 MiB** (ships over the wire) |
| JS glue `dist/mupdf.js` | 103,369 B |
| Runtime | Node v22 locally (spec target Node 20 LTS; pure-WASM, no native deps) |

The PDF engine adds ~3.4 MB brotli on top of the ~185 MB NER model — negligible, one-time cached.

## 2. Timing (per page: search + mark + applyRedactions + save + reopen)

| Fixture | Full-rewrite+garbage | Notes |
|---|---|---|
| Latin (base-14 font, 835 B) | ~5 ms/page | tiny file |
| Hebrew (embedded Arial, 586 KB) | ~15 ms/page | dominated by re-serialising the 1 MB embedded font |

Redaction throughput is not a concern; the cost is font/stream serialisation, not the redaction.

## 3. Three-layer acceptance test — incremental vs full-rewrite

Enforced in `src/acceptance.mjs`: **A** re-extract structured text -> PII absent; **B** raw-byte scan
of the file PLUS every inflated non-asset stream, in UTF-8 / UTF-16LE / reversed forms -> PII absent;
**C** structure -> exactly one `%%EOF` and one `startxref`.

| Fixture | Save mode | A (text) | B (bytes) | C (structure) | Verdict |
|---|---|---|---|---|---|
| Latin  | incremental          | PASS | **FAIL** (name/ID/phone recoverable) | **FAIL** (2x EOF) | **LEAKS** |
| Latin  | full-rewrite+garbage | PASS | PASS | PASS | **TRUE REMOVAL** |
| Hebrew | incremental          | PASS | PASS(1) | **FAIL** (2x EOF) | **LEAKS** |
| Hebrew | full-rewrite+garbage | PASS | PASS | PASS | **TRUE REMOVAL** |

(1) See section 5 — for embedded-CID-font PDFs the byte scan is blind to native-Unicode PII (stored as
glyph IDs, not scannable text); Layer C is what catches the incremental leak there.

## 4. THE gotcha — "not incremental" is necessary but NOT sufficient; garbage is mandatory

`applyRedactions` replaces the page content stream with a new object and ORPHANS the old one. A plain
full rewrite still serialises that orphan, so PII stays byte-recoverable even with a single `%%EOF`.
Only garbage collection drops it. Proven matrix (`npm run spike:options`):

```
opt                                                       | A    | B    | C    | EOF | verdict
{"incremental":true}                                      | PASS | FAIL | FAIL |  2  | LEAKS
{}                (full rewrite, no gc)                    | PASS | FAIL | PASS |  1  | LEAKS   <- single %%EOF but STILL leaks
{"compress":true} (still no gc)                           | PASS | FAIL | PASS |  1  | LEAKS
{"garbage":"compact"}                                     | PASS | PASS | PASS |  1  | TRUE REMOVAL
{"garbage":"compact","compress":true,"sanitize":true}     | PASS | PASS | PASS |  1  | TRUE REMOVAL
{"garbage":"deduplicate","compress":true,"sanitize":true} | PASS | PASS | PASS |  1  | TRUE REMOVAL
```

Do NOT rely on the `%%EOF` count alone to judge a redaction safe — a file can have one `%%EOF` and
still leak. The byte scan (Layer B) is the check that catches the missing-garbage case.

### Exact save options for PDF-04 to copy (guarantees true removal)

```js
// mupdf 1.28.0 — page.applyRedactions on every page, THEN:
const SAFE_SAVE_OPTIONS = { garbage: "deduplicate", compress: true, sanitize: true };
const bytes = doc.saveToBuffer(SAFE_SAVE_OPTIONS).asUint8Array();
// serialises to: "garbage=deduplicate,compress=yes,sanitize=yes"
// NEVER: { incremental: true }
```

`garbage:"compact"` already passes all three layers; `"deduplicate"` is belt-and-suspenders. The
redaction call used:

```js
page.applyRedactions(
  true,                          // black_boxes
  PDFPage.REDACT_IMAGE_PIXELS,   // image_method (see section 6 caveat)
  PDFPage.REDACT_LINE_ART_NONE,  // line_art_method
  PDFPage.REDACT_TEXT_REMOVE     // text_method — this removes the text
);
```

## 5. Hebrew-specific findings (feed PDF-03 bidi + PDF-06 sanitize)

The Hebrew fixture embeds Arial as a Type0 / Identity-H font (glyph-ID content stream). Text redaction
works and passes all three layers, but three real gotchas surfaced:

1. **Reversed extraction (documented MuPDF Hebrew treachery).** A Hebrew run extracts in visual
   (reversed) order: planted `ישראל ישראלי` comes back as `ילארשי לארשי`. A forward `search()` for the
   logical string returns 0 hits. The locator only found the name via the reversed form. -> PDF-03 must
   derive rects from per-glyph quads with a logical<->visual index map, never by string-searching the
   reordered extracted text.
2. **ASCII hyphen -> U+00AD, and search() splits on it.** The `-` in `052-1234567` round-trips through
   MuPDF's generated ToUnicode as U+00AD (soft hyphen), and search() treats it as a break, so the phone
   is only findable as split tokens `052` + `1234567`. Locating by full formatted string fails silently.
   The acceptance test must normalise away separators/bidi before asserting absence — a naive
   `text.includes("052-1234567")` gives a FALSE PASS (stored form differs). This bit the spike and is fixed.
3. **Byte-scan blind spot for CID fonts.** In an embedded-Type0 PDF the PII exists nowhere as UTF-8/16
   bytes — it is glyph IDs in the content stream and hex bfchar entries in ToUnicode. Layer B cannot see
   it; Layer C caught the incremental leak. -> for full coverage PDF-04/PDF-06 should also decode
   content-stream GIDs via the font cmap and decode ToUnicode hex, or rely on Layer A + Layer C + gc save.
4. **No font subsetting.** `addFont` embeds the entire 1 MB Arial -> 586 KB fixture. Output-size concern,
   not a redaction issue.

Layer B must also SKIP embedded font/image binary streams — a font's internal `0123456789` table
false-positives against short numeric needles (3-char `052` matched inside the 1 MB Arial blob).
`src/acceptance.mjs` scopes the byte scan to the current object's dict and excludes `/FontFile*`,
`/Length1`, image and font streams.

## 6. Image-pixel redaction — UNVERIFIED / did not take effect (gates PDF-05)

`npm run spike:image` builds a plain RGB image XObject and a soft-masked (transparent) image (the
PyMuPDF #434 segfault class) via `addImage`, drops a Redact annotation over it, applies
`REDACT_IMAGE_PIXELS`.

- No segfault / no crash on either — the #434 crash class did NOT reproduce in mupdf 1.28.0 WASM.
- But image pixels were NOT destroyed. Rendered pixels are identical before/after; same no-op for
  `REDACT_IMAGE_REMOVE`, for a full-image-bbox rect, and after `annot.update()` — while TEXT redaction
  on the identical annotation mechanism fully works.

Interpretation: image redaction over a synthetic `addImage` XObject is a no-op in this build/fixture.
This is exactly the risk PDF-01 exists to surface: the scanned-PDF/OCR redaction path (PDF-05) cannot be
assumed working and needs its own verification — likely a real rasterised page image (not a synthetic
XObject), a re-OCR check of the redacted region, and possibly a newer mupdf or the
render-pixmap -> paint -> re-embed fallback. It does NOT block the text pipeline.

## 7. Output validity

Every redacted output (Latin + Hebrew, both save modes) re-opens and renders to a PNG via `toPixmap`
(`out/*.png`) — the redacted PDFs are valid.

## 8. GO / NO-GO

- **GO** — text-PDF redaction (PDF-03 text/bidi, PDF-04 output pipeline). mupdf removes text content
  truly and verifiably client-side; the 3-layer test passes with the garbage-collected full-rewrite save.
- **CONDITIONAL / re-spike** — image and scanned-PDF redaction (PDF-05): image-pixel destruction is
  unverified here. Treat PDF-05 as its own gate.
- Carry to PDF-06 (sanitize): redaction != sanitisation; the byte scan must also cover metadata,
  ToUnicode, outlines, annotations, and (for Hebrew) hex-encoded / glyph-ID text.

---

## Reproduction (Windows, npm/node)

```
cd spikes/pdf-01
npm install
npm run spike            # build fixtures + latin + hebrew + options-matrix + image probe

# individually:
npm run build:fixtures   # writes fixtures/latin.pdf and fixtures/hebrew.pdf
npm run spike:latin      # Latin 3-layer test, incremental vs full-rewrite
npm run spike:hebrew     # Hebrew 3-layer test (needs a Hebrew-capable TTF)
npm run spike:options    # save-options matrix (proves garbage is mandatory)
npm run spike:image      # image-pixel / soft-mask (#434) probe
```

**Hebrew fixture font:** the builder reads a Hebrew-capable TTF, default `C:/Windows/Fonts/arial.ttf`;
override with `HEB_FONT=/path/to/font.ttf`. Generated `fixtures/hebrew.pdf` and `out/*` embed Arial
(proprietary) and are `.gitignore`d — never commit them; regenerate locally. All PII is synthetic.

## Files

- `src/pii.mjs` — synthetic planted PII.
- `src/build-latin.mjs` / `src/build-hebrew.mjs` — fixture builders.
- `src/extract.mjs` — structured-text extraction helper.
- `src/redact.mjs` — search -> quad -> Redact annotation -> applyRedactions; SAFE_SAVE_OPTIONS; save modes.
- `src/acceptance.mjs` — three-layer test (separator/bidi normalisation + inflate-and-scan).
- `src/run.mjs` — per-fixture runner (incremental vs full-rewrite + render check).
- `src/save-options-matrix.mjs` — proves garbage collection is mandatory.
- `src/image-probe.mjs` — image-pixel / soft-mask (#434) probe.
