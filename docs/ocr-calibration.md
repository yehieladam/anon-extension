# OCR scan-quality calibration (Stage 1 / OCR-01)

Calibration of the scanned-PDF (OCR) redaction path's quality gate and the failure analysis that
shaped it. All PII in the corpus is synthetic (fictional names, checksum-shaped IDs). The gate lives in
[`engine/src/scanGate.ts`](../engine/src/scanGate.ts); thresholds below are locked there.

## Locked values

| Constant | Value | Role |
|---|---|---|
| `OCR_RENDER_DPI` | 200 | Fixed render resolution for every scan (Stage A). heb+eng LSTM confuses Hebrew for Latin at 300; 200 keeps a clean baseline ~90 with room above the fail band. |
| `MAX_LOW_CONF_RATIO` | 0.12 | **Primary separator.** Fraction of words below `LOW_CONF_WORD_FLOOR`; page refused if exceeded. |
| `LOW_CONF_WORD_FLOOR` | 60 | A word counts as "low confidence" below this. |
| `SCAN_MEAN_CONF_FLOOR` | 75 | **Weak backstop only** — the illegible-collapse floor, not a fail-catcher (see below). |

Empty / unreadable page → refuse (never silently pass).

## The gate is one layer, not the whole guarantee

The most important finding of Stage 1: **the dangerous OCR failure is a confident misread, not a
dropped word, and no page-level aggregate signal can catch it.**

An all-1s Israeli ID (`111111118` — a column of vertical strokes) at fax-grade resolution collapses to
a run of Hebrew vav glyphs `פוווווווו`: **zero digits, high word confidence, lowRatio 0**. It is
invisible to meanConf, to lowRatio, and (proven below) to variance-of-Laplacian. The failure is
*content-specific* — which glyph a given character degrades into — not an image-quality scalar, so it
cannot be a gate signal.

Confident misreads are therefore defended at the **content layer** in the redaction pipeline (Stage 3),
not by the gate:

1. **Label-anchored redaction** (content-blind) — any OCR token that contains or is spatially adjacent
   to a PII label (`שם` / `שם הלקוח` / `שם המבקש` / `שם מלא`, `תעודת זהות` / `ת"ז` / `מספר זהות`,
   `טלפון` / `נייד` / `פקס`) has its whole bbox redacted regardless of content. This is what covers the
   `פוווווווו` case: OCR merged the label and value into one token whose bbox spans the real ID pixels.
   Over-redacts the label itself — acceptable (labels are not PII; over-redaction is the correct
   direction).
2. **ID relax-checksum in scan mode** — redact any ~9-digit run near an ID context even if the checksum
   fails (a digit misread that stays digit-shaped).
3. **Phone bbox pixel self-heal** — phone has no checksum, so a misread that stays phone-shaped
   (`0XX-XXXXXXX`) still matches the detector; redaction whites out the real pixels regardless of the
   wrong digits. (Verify mechanism: confirm the pipeline redacts the OCR word's bbox pixels, not
   re-inserted text.)

The gate's job is only the **unsure-degradation tier**: scans that read so poorly the whole file must be
refused. All three Stage-3 mechanisms are **required**, not optional.

### meanConf is a weak backstop — do not tighten it to catch fails

lowRatio is the real discriminator. On the corpus a **FAIL** sits at meanConf **81.3** (d1 lowres-50)
while a **PASS** sits at meanConf **79.4** (d1 lowres-60) — the fail outranks the pass, so meanConf
cannot separate. `FLOOR = 75` only rejects the fully collapsed reads (d3 at 61–68). Anyone later raising
`FLOOR` expecting it to catch recall failures is mistaken; it won't, and it will start false-refusing
clean scans.

### Adjustment band

`MAX_LOW_CONF_RATIO = 0.12` is deliberately slightly refuse-leaning: it sits between the corpus
clean-max `0.091` (+0.029 headroom to accept clean) and fail-min `0.167` (−0.047 to refuse fails). If
production shows clean scans false-refusing, the safe adjustment band is **[0.12, 0.14]**. The **hard
ceiling is < 0.167** — never cross it; that is where real recall failures begin. The corpus is small
(~16 clean/mild samples set the `.091` clean-max), which is why the threshold leans conservative.

## Q2 negative result — variance-of-Laplacian refuted

Tested as a candidate 3rd signal (effective-resolution / sharpness). It does **not** separate:

- PASS vLap range **[2.0, 760.4]** (n=56).
- Confident FAIL vLap: 83.4, 92.9, 100.6, 418.1 — **all inside the PASS band.**

It is anti-correlated with the failure: box-blur destroys recall the least but tanks vLap (passes at
2.0–5.3), while the low-res model's nearest-neighbour upscale injects hard block edges that spike vLap on
the actual leaks. Min-digit-word-confidence fails for the same reason — the misread digits carry *high*
confidence; that is the pathology itself. No aggregate image-quality signal was viable. (Harness:
`scripts/q2-sharpness.mjs`, deterministic, offline, no OCR.)

## Excluded sample — recorded, not silently dropped

**`d3-nahum / low-source-res` (render-at-90-DPI) is excluded from threshold fitting.** It is a
confident FAIL (dropped the name `פרץ`→`Y19`, meanConf 87.5, lowRatio 0.083) but maps to **no
production code path**: we render every scan at 200 DPI and never downrender to 90. Its faithful model —
downscale the source then upscale back to 200 (`lowres-90`) — **passes**. Rendering at 90 changes font
hinting/subpixel rendering, not just effective resolution, so it is a modeling artifact. In the faithful
(downscale→upscale) model, names fail only in the high-lowRatio tier the gate already refuses. This
exclusion is recorded here explicitly so it is not mistaken for data-massaging.

## Residual limitation (known v1)

An **unlabeled** value that OCR collapses into a **non-matching** token — not digit-shaped (relax-checksum
can't fire) and not labeled (label-anchor can't fire) — at **sub-envelope resolution** (fax-grade,
≤~60-DPI-equivalent, below the realistic legal-scan envelope) is **uncovered**. It is bounded (requires
both conditions simultaneously) but real, and documented rather than hidden. This is the honest boundary
of the v1 OCR path; the alternative — pretending it doesn't exist — is the failure mode the project
forbids.

## Corpus — 64 samples (4 docs × 16 degradations)

`recall` column: N=name, I=ID, P=phone read exactly (dash = missed). "Result" is recall completeness,
the ground truth the gate is measured against.

<!-- generated: scripts/ocr-calibrate.mjs (recall) + scripts/q2-sharpness.mjs (vLap) -->

| doc | degradation | meanConf | lowRatio | vLap | recall | result |
|---|---|---|---|---|---|---|
| d1-moshe | blur | 90.9 | 0 | 21.7 | NIP | PASS |
| d1-moshe | blur-s1.5 | 92.3 | 0 | 9.2 | NIP | PASS |
| d1-moshe | blur-s2.0 | 92.4 | 0 | 5.2 | NIP | PASS |
| d1-moshe | blur-s2.5 | 92.1 | 0 | 3.3 | NIP | PASS |
| d1-moshe | blur-s3.0 | 92.5 | 0 | 2.3 | NIP | PASS |
| d1-moshe | clean | 92.3 | 0 | 133.0 | NIP | PASS |
| d1-moshe | jpeg-q40 | 89.8 | 0 | 133.0 | NIP | PASS |
| d1-moshe | low-source-res | 90.6 | 0 | 396.1 | NIP | PASS |
| d1-moshe | lowres-50 | 81.3 | 0.167 | 92.9 | NI- | **FAIL** (gate refuses: lowRatio) |
| d1-moshe | lowres-60 | 79.4 | 0.167 | 106.6 | NIP | PASS recall; gate refuses (refuse-leaning) |
| d1-moshe | lowres-75 | 91.2 | 0 | 133.8 | NIP | PASS |
| d1-moshe | lowres-90 | 91.5 | 0 | 149.2 | NIP | PASS |
| d1-moshe | noise-light | 91.9 | 0 | 286.9 | NIP | PASS |
| d1-moshe | noise-med | 92 | 0 | 752.4 | NIP | PASS |
| d1-moshe | skew1.5 | 91.8 | 0 | 123.5 | NIP | PASS |
| d1-moshe | skew2+noise | 92.3 | 0 | 273.6 | NIP | PASS |
| d2-yosef | blur | 92.4 | 0 | 19.1 | NIP | PASS |
| d2-yosef | blur-s1.5 | 92.1 | 0 | 8.2 | NIP | PASS |
| d2-yosef | blur-s2.0 | 89.6 | 0 | 4.6 | NIP | PASS |
| d2-yosef | blur-s2.5 | 91.7 | 0 | 2.9 | NIP | PASS |
| d2-yosef | blur-s3.0 | 91.7 | 0 | 2.0 | NIP | PASS |
| d2-yosef | clean | 88.1 | 0.083 | 114.1 | NIP | PASS |
| d2-yosef | jpeg-q40 | 90.1 | 0 | 114.1 | NIP | PASS |
| d2-yosef | low-source-res | 88.6 | 0 | 352.8 | NIP | PASS |
| d2-yosef | lowres-50 | 85.5 | 0 | 83.4 | N-P | **FAIL** (confident ID→letters; content-layer label-anchor) |
| d2-yosef | lowres-60 | 85.3 | 0 | 92.9 | N-P | **FAIL** (confident ID→letters; content-layer label-anchor) |
| d2-yosef | lowres-75 | 90.8 | 0 | 121.8 | NIP | PASS |
| d2-yosef | lowres-90 | 86.8 | 0.083 | 131.5 | NIP | PASS |
| d2-yosef | noise-light | 88.5 | 0.083 | 268.5 | NIP | PASS |
| d2-yosef | noise-med | 86.7 | 0.083 | 734.6 | NIP | PASS |
| d2-yosef | skew1.5 | 89.5 | 0 | 108.7 | NIP | PASS |
| d2-yosef | skew2+noise | 89.4 | 0 | 262.5 | NIP | PASS |
| d3-nahum | blur | 90.5 | 0 | 22.5 | NIP | PASS |
| d3-nahum | blur-s1.5 | 92.5 | 0 | 9.5 | NIP | PASS |
| d3-nahum | blur-s2.0 | 92 | 0 | 5.3 | NIP | PASS |
| d3-nahum | blur-s2.5 | 92.2 | 0 | 3.4 | NIP | PASS |
| d3-nahum | blur-s3.0 | 92.3 | 0 | 2.3 | NIP | PASS |
| d3-nahum | clean | 91.9 | 0 | 140.4 | NIP | PASS |
| d3-nahum | jpeg-q40 | 85.7 | 0.083 | 140.4 | NIP | PASS |
| d3-nahum | low-source-res | 87.5 | 0.083 | 418.1 | -IP | **FAIL** (EXCLUDED — render-at-90 artifact) |
| d3-nahum | lowres-50 | 67.8 | 0.25 | 99.6 | --- | **FAIL** (gate refuses: both signals) |
| d3-nahum | lowres-60 | 61.7 | 0.417 | 117.5 | N-- | **FAIL** (gate refuses: both signals) |
| d3-nahum | lowres-75 | 88.3 | 0 | 141.2 | NIP | PASS |
| d3-nahum | lowres-90 | 84 | 0.167 | 154.0 | NIP | PASS recall; gate refuses (refuse-leaning) |
| d3-nahum | noise-light | 91.8 | 0 | 294.4 | NIP | PASS |
| d3-nahum | noise-med | 91.6 | 0 | 760.4 | NIP | PASS |
| d3-nahum | skew1.5 | 92 | 0 | 126.3 | NIP | PASS |
| d3-nahum | skew2+noise | 92.2 | 0 | 279.1 | NIP | PASS |
| d4-miriam | blur | 89 | 0 | 19.6 | NIP | PASS |
| d4-miriam | blur-s1.5 | 92 | 0 | 8.3 | NIP | PASS |
| d4-miriam | blur-s2.0 | 92 | 0 | 4.7 | NIP | PASS |
| d4-miriam | blur-s2.5 | 92 | 0 | 3.0 | NIP | PASS |
| d4-miriam | blur-s3.0 | 92.3 | 0 | 2.0 | NIP | PASS |
| d4-miriam | clean | 90.5 | 0 | 123.1 | NIP | PASS |
| d4-miriam | jpeg-q40 | 86.7 | 0.091 | 123.1 | NIP | PASS |
| d4-miriam | low-source-res | 88.2 | 0 | 364.1 | NIP | PASS |
| d4-miriam | lowres-50 | 79.8 | 0.182 | 88.0 | NI- | **FAIL** (gate refuses: lowRatio) |
| d4-miriam | lowres-60 | 87.3 | 0 | 100.6 | NI- | **FAIL** (confident phone; self-heals via pixel redaction) |
| d4-miriam | lowres-75 | 85.7 | 0.182 | 120.9 | NIP | PASS recall; gate refuses (refuse-leaning) |
| d4-miriam | lowres-90 | 91.2 | 0 | 136.9 | NIP | PASS |
| d4-miriam | noise-light | 89.4 | 0 | 277.8 | NIP | PASS |
| d4-miriam | noise-med | 87.8 | 0 | 743.8 | NIP | PASS |
| d4-miriam | skew1.5 | 81.6 | 0.091 | 113.0 | NIP | PASS |
| d4-miriam | skew2+noise | 92.3 | 0 | 265.5 | NIP | PASS |

**8 FAILs, resolved:** 3 caught by the gate (lowRatio ≥ 0.167: d1/d3/d4 lowres-50, d3 lowres-60); 3
confident misreads passed to the content layer (d2 lowres-50/60 ID via label-anchor; d4 lowres-60 phone
via pixel self-heal); 1 excluded artifact (d3 low-source-res). The gate never passes an *unsure* fail;
the content layer covers every *confident* fail except the documented unlabeled-value residual.

## Reproduce

Offline, foreground, per-sample incremental output (never a blind background batch):

```
node scripts/fetch-tesseract-assets.mjs                       # vendor tesseract + heb/eng traineddata
node --dns-result-order=ipv4first scripts/ocr-calibrate.mjs 1  # ... 2 3 4, then: merge
node scripts/q2-sharpness.mjs                                  # vLap negative-result check
```
