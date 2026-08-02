# Client-side (in-browser) anonymizer — feasibility & phased plan

> For the **public free tool** (not the authenticated portal). Goal: detection runs in the
> user's browser, the server only hosts static files. Result: scales to unlimited users at
> near-zero server cost, and the document never leaves the device (privacy by architecture).

## Verdict: feasible, and the enabler already exists

The main risk was "can Hebrew NER run in the browser?" — **yes**. The exact model we use is
already published in ONNX:

- **`onnx-community/dictabert-ner-ONNX`** — dictabert-ner converted to ONNX, ready for
  transformers.js. **No conversion work needed.** Same PERSON/ORG/LOCATION model, in-browser.
  ([HF](https://huggingface.co/onnx-community/dictabert-ner-ONNX))
- **transformers.js** runs it via ONNX Runtime Web with a `token-classification` pipeline,
  supports quantization (`q8` default on WASM, `q4`, `fp16`, `fp32` on WebGPU), and WebGPU
  (Chrome/Edge 113+) is ~10x faster than WASM.
  ([docs](https://huggingface.co/docs/transformers.js/en/index))

## Target architecture (fully client-side)

```
Browser (everything runs here)
  file/paste ──► extract text (JS) ──► detect ──► anonymize ──► copy / download
                                        │            └─ reversible key (JS)
                                        ├─ regex+checksum recognizers (JS)   ← most Israeli PII
                                        └─ dictabert-ner-ONNX via transformers.js ← names/orgs/places
Server = static file hosting only (Vercel/CDN). No PII ever reaches it.
```

## Component-by-component

| Piece | Today (Python) | In browser (JS) | Effort |
|-------|----------------|-----------------|--------|
| **Deterministic recognizers** (ת"ז Luhn, טלפון, IBAN, ח"פ, תיק, גוש-חלקה, פוליסה, מבוטח, email) | Presidio PatternRecognizers | plain JS regex + Luhn — trivial port | **S** |
| **Hebrew NER** (שם/ארגון/מקום) | dictabert + transformers | `pipeline('token-classification','onnx-community/dictabert-ner-ONNX')` via transformers.js | **M** (wiring + tuning, model ready) |
| **Overlap resolution + placeholders + reversible key** | analyze.py / anonymize.py | pure JS port of the same logic | **S–M** |
| **Restore (tolerant)** | anonymize_files.py | pure JS port | **S** |
| **Text extraction — PDF** | pdfplumber + bidi | **pdf.js** (text + x/y positions) | **M** (+ Hebrew bidi reorder in JS) |
| **Text extraction — DOCX** | python-docx | **mammoth.js** | **S** |
| **Text extraction — XLSX** | openpyxl | **SheetJS (xlsx)** | **S** |
| **Anonymized file OUTPUT (docx/xlsx)** | python-docx/openpyxl writers | docx: `docx`/`docxtemplater`; xlsx: SheetJS write | **M** |
| **PDF true redaction** (remove text + stamp box) | PyMuPDF `apply_redactions` | **hardest** — pdf.js is read-only; writing needs `pdf-lib`, and true content removal is non-trivial in JS | **L / risk** |
| **UI** | Streamlit | React (or plain) frontend | **M–L** (rebuild the approved mockup for real) |

## Model size & performance (verify exact numbers)

- dictabert-ner is BERT-base (~110M params). Rough download: fp32 ONNX ~440MB, **q8 (int8)
  ~110MB, q4 ~55MB** — one-time per browser, then cached. (Confirm exact sizes on the model
  card — couldn't fetch during research.)
- Speed: WASM = a few seconds/doc on CPU; **WebGPU** (modern Chrome/Edge) = sub-second.
  Old phones / no-WebGPU fall back to WASM (slower, more RAM).

## Why this is the right move (ties to earlier discussions)

- **Scaling:** server does zero inference → static hosting → unlimited free users, cheap.
- **Privacy/compliance:** the document never touches your server → you are NOT a data
  controller/processor, GDPR/privacy-law exposure drops away. This is the clean answer to the
  "free tool for everyone" idea.

## Honest risks / open questions

1. **Hebrew NER quality after quantization** — q8/q4 may lose some recall vs the full model.
   Must A/B the ONNX-quantized model against the current server model on real docs.
2. **PDF true redaction in the browser** — the hardest gap. Options: (a) skip PDF redaction
   client-side, output anonymized **text/docx** only; (b) keep only PDF redaction server-side
   (tiny, stateless) while everything else is client-side; (c) invest in pdf-lib redaction.
3. **First-load ~110MB** on slow networks / weak devices.
4. **It's a rewrite** — Python→JS + Streamlit→React. Weeks, not hours. The current portal tool
   stays server-side; this is a separate build for the public product.

## Phased plan

- **Phase 0 — spike (½–1 day):** static HTML page that loads `dictabert-ner-ONNX` via
  transformers.js and runs NER on a few Hebrew sentences in the browser. Measure: download
  size, first-run time, recall vs the server model. **Go/no-go gate.**
- **Phase 1 — regex client-side:** port the deterministic recognizers to JS. Even alone this
  covers most structured Israeli PII with zero server load.
- **Phase 2 — NER client-side:** transformers.js + dictabert-ner-ONNX; port overlap/anonymize/
  restore to JS. Now detection is fully in-browser.
- **Phase 3 — files:** pdf.js/mammoth/SheetJS for extraction; docx/xlsx output. Decide PDF
  redaction (defer, or keep server-side).
- **Phase 4 — frontend + ship:** rebuild the approved mockup as a real React app on static
  hosting. Public launch with the privacy story front and center.

## Next concrete step

Run **Phase 0**: the in-browser dictabert-ner-ONNX spike, to confirm Hebrew quality + size
before committing to the rewrite.
