# Chrome extension plan — client-side Hebrew PII anonymizer (popup, public Store)

> Decided with the user 2026-07-30; all open decisions resolved 2026-08-02. **Shape:** a public
> Chrome Web Store extension with a **popup** UI (paste text or upload a file → get an anonymized
> version), running detection **fully in the browser** (no server, PII never leaves the device).
> **Anonymize-only MVP** (no restore/re-identify), **completely free** (no account, no server —
> privacy purity is the product). Model files are **self-hosted** on our VPS/CDN in production
> (the spike loads from the HF CDN to move fast). **PDF in-place redaction is OUT of the MVP**
> — it is its own later hard spike (§4). This builds directly on the validated Phase-0 spike
> ([[../browser-poc]], `PHASE0_FINDINGS.md`) and the engine described in
> `docs/client-side-plan.md`. The current Streamlit portal tool stays as-is; this is a separate track.
>
> **Status:** the MV3 spike is BUILT under `extension/` (see §6 and `extension/README.md`) and
> awaits a manual load-unpacked verification in real Chrome.

## 1. The one big idea: one engine, thin shells

The detection **engine** (regex+checksum recognizers, dictabert NER via transformers.js,
overlap-resolution, anonymize, restore, key generation) is the SAME code whether it powers a web
app OR this extension. Build it once as a standalone, framework-free JS module (`engine/`), then the
extension is a thin shell around it. A future public web app reuses the identical module. This is
why we do client-side first and the extension as a layer — not double work.

```
engine/                      ← pure JS, no DOM, no extension APIs (reusable)
  recognizers/*.js           ← ת"ז(Luhn)/טלפון/IBAN/ח"פ/תיק/גוש-חלקה/פוליסה/מבוטח/email  (port of src/recognizers/*)
  ner.js                     ← transformers.js token-classification wrapper + Phase-0 shims
  resolve.js                 ← overlap resolution (port of analyze.py PRIORITY logic)
  anonymize.js               ← placeholders + reversible key (port of anonymize.py)
  restore.js                 ← placeholders → originals — POST-MVP (MVP is anonymize-only;
                                the key CSV is still produced so restore can come later)
  extract/{docx,xlsx}.js     ← mammoth / SheetJS (pdf extract deferred with the PDF spike, §4)
extension/                   ← the Chrome shell (thin)
  manifest.json (MV3)
  popup/                     ← the paste/upload UI (reuses engine)
  offscreen/ (later)         ← keeps the model warm across popup opens
```

## 2. Architecture (MV3, client-side)

- **Popup** = the whole UX for the MVP. User opens the extension, pastes text or drops a file,
  sees highlighted detections + an anonymized copy + a downloadable key. The engine runs IN the
  popup page (popup pages can run WASM/WebGPU).
- **Model load:** on popup open, transformers.js loads `dictabert-ner-ONNX` q8 (~185 MB) from
  cache (IndexedDB/Cache API). First ever use downloads it once; afterwards it's local. Show a
  one-time "installing engine" progress bar (idea: prefetch on install / on first open in the
  background so the first real use is instant).
- **Warm-model optimization (post-MVP):** an **offscreen document** hosts the loaded pipeline so
  it survives popup close → no re-init per open. MV3 offscreen needs a justification reason (no
  clean "ML" enum — validate `WORKERS`/`BLOBS`/`DOM_PARSER` in the spike). MVP can skip this and
  reload-from-cache each open (a few seconds, spinner); add offscreen only if that friction annoys.
- **NOT the service worker** for inference: MV3 service workers have no WebGPU, are killed after
  ~30 s idle, and reloading 185 MB there is painful. Keep inference in popup/offscreen (a document
  context).
- **Backend WASM by default** (Phase-0 finding: WASM beat WebGPU on integrated GPUs). Try WebGPU
  opportunistically, fall back to WASM.

## 3. MV3 constraints that will bite (address up front)

1. **No remote code.** MV3 CSP (`script-src 'self' 'wasm-unsafe-eval'`) forbids loading JS from a
   CDN. **Spike-verified approach:** no bundler needed — the npm `dist/transformers.min.js` of
   `@huggingface/transformers@4.2.0` is a self-contained ES module (exports `pipeline`, `env`);
   vendor it into `extension/vendor/` and `import` it locally.
   **Non-obvious trap found while building the spike:** transformers.js v4 *also* loads the
   onnxruntime-web runtime (`ort-wasm-simd-threaded.asyncify.mjs` + `.wasm`) from jsdelivr at
   runtime by default — the `.mjs` is remote CODE and MV3 blocks it. Must vendor those two files
   too (from the exact onnxruntime-web version transformers pins — `1.26.0-dev.20260416-b7804b056c`
   for 4.2.0) and override `env.backends.onnx.wasm.wasmPaths` to the local copies before creating
   the pipeline. Also pin `numThreads = 1`: extension pages are not crossOriginIsolated, and ORT's
   multithread path spawns blob workers that MV3 CSP blocks.
2. **WASM needs `'wasm-unsafe-eval'`** in the extension_pages CSP — allowed, must be declared.
3. **Model weights are DATA, not code** → they may be fetched at runtime. **DECIDED: self-host**
   the model files on our VPS/CDN for production (reliability, control, a single `connect-src`
   entry, no third-party dependency, and we can ship a pre-patched `tokenizer.json` that makes the
   RegExp shim unnecessary). Files to mirror from `onnx-community/dictabert-ner-ONNX`:
   `config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/model_quantized.onnx` (~185 MB)
   — confirm the exact request list in DevTools on a cold load. The self-host must serve
   `Access-Control-Allow-Origin: *` (the extension fetches cross-origin with no host_permissions).
   The **spike** loads from the HF CDN (`connect-src https://huggingface.co https://*.huggingface.co
   https://*.hf.co` — HF redirects big files to `*.hf.co`) purely to move fast; switch =
   `env.remoteHost` + one `connect-src` line.
4. **Tokenizer shims from Phase 0 are mandatory in the engine port:**
   - `\"`/`\'` illegal under `/u` → the ~30-line RegExp shim (or ship a patched, self-hosted
     `tokenizer.json`). Without it, NER never runs. See `browser-poc/PHASE0_FINDINGS.md`.
   - transformers.js returned null char offsets + `##` wordpiece markers → the port must reconstruct
     offsets and strip/re-join `##` so placeholders land on whole entities (incl. hyphenated names).
5. **Minimal permissions** (helps Store review + user trust): a popup paste/upload tool needs NO
   broad host permissions, NO tabs, NO scripting. Only `connect-src` to the model host (or self-host
   same-origin). Keep the permission list tiny — it's a selling point for a privacy tool.

## 4. File handling scope (phase it)

| Format | Extract (read) | Anonymized output | MVP? |
|--------|----------------|-------------------|------|
| Pasted text | — | text + key | ✅ MVP |
| DOCX | mammoth.js | `docx`/docxtemplater (placeholders in text) | ✅ MVP |
| XLSX | SheetJS | SheetJS write | ✅ MVP |
| PDF | pdf.js (text + positions) + JS bidi | **hard** — true in-place redaction needs pdf-lib; the PyMuPDF stamping/positional logic has no clean JS twin | ❌ not in MVP — separate spike |

**DECIDED:** MVP ships text + DOCX + XLSX. **PDF is fully out of the MVP** — do not even ship a
degraded "PDF in → text out" mode at launch (it muddies the promise; add only if users ask).
The eventual product DOES want true in-place PDF redaction (layout preserved, like the server
tool), and that is **its own dedicated hard spike, on its own timeline**: pdf-lib in the browser,
re-implementing the tight word-run matching + box-fitting logic that took real effort server-side
(see memories `pdf-inplace-redaction-requirement`, `pdf-redaction-precise-matching`). There is no
clean JS equivalent of PyMuPDF's redaction API, so treat it as research-risk, not a feature ticket.

## 5. Chrome Web Store

- **Privacy story = the pitch.** "100% local, nothing leaves your browser, no account, no server."
  Fill the Store data-safety form as "no data collected" (true). This is a strong differentiator.
- **DECIDED: completely free.** No paid tier, no account, no licensing plumbing — anything with an
  account or license check needs a server and breaks the privacy purity that IS the product. If
  monetization ever comes, it is a separate product decision, not something to pre-wire now.
- **Review:** MV3 extensions get reviewed; minimal permissions + no remote code + a clear privacy
  policy page = smooth review. Write a one-page privacy policy (host it, link in the listing).
- **Listing assets:** name, 128px icon, screenshots (popup with Hebrew detection highlighted),
  short + long description (Hebrew + English), a promo tile. RTL-correct Hebrew screenshots.
- **First-load UX:** be explicit in the listing that a one-time ~185 MB engine download happens on
  first use (set expectations; avoid 1-star "it's downloading" reviews).
- **Updates:** the engine module is bundled; model files are self-hosted → you can improve the model
  without a Store re-review (just swap the hosted files, version them).

## 6. Phased roadmap

- **Spike — BUILT (2026-08-02), awaiting manual verification:** `extension/` contains a loadable
  MV3 extension — popup with a Hebrew-prefilled textarea + button, transformers.js AND the
  onnxruntime WASM runtime vendored locally, the Phase-0 RegExp shim as a pre-module classic
  script, zero permissions, CSP with `'wasm-unsafe-eval'` + `connect-src` to HF. See
  `extension/README.md` for the load-unpacked steps and the go/no-go criteria. What it proves
  once loaded: model downloads+caches in the extension origin, NER runs under MV3 CSP, WASM path
  works, shim fires. **The ML quality/speed is already proven in Phase 0 — this is purely the
  extension mechanics.** Known spike-stage wrinkle: the popup dies on outside click (aborts the
  first 185 MB download) — the popup links to opening itself in a full tab as the stopgap; the
  real fixes are P4 (offscreen) and/or prefetch-on-install.
- **P1 — engine module:** port the deterministic recognizers to JS (fast, covers most Israeli PII),
  then the NER wrapper with offset/`##` handling, resolve+anonymize+key (restore.js deferred —
  anonymize-only MVP, but keep the key format restore-compatible). Unit-test each JS recognizer
  against the same valid/invalid cases as `check_task1.py`, and NER recall against
  `browser-poc/ner_testset.json` (target: match the 88.89% server/Phase-0 parity).
- **P2 — popup UX:** the paste flow end-to-end (detect → highlight → anonymized copy → download key),
  reusing the approved "Organic" design tokens ([[organic-design-system]]) so it looks like the
  Streamlit tool. Add the keep-word rescue + type toggles (mirror the current app).
- **P3 — files:** DOCX + XLSX in/out (mammoth/SheetJS). No PDF (§4).
- **P4 — warm model + self-host:** offscreen document to keep the pipeline loaded across popup
  opens (validate the justification enum — no clean "ML" reason exists); switch the model source
  from HF CDN to our VPS/CDN (`env.remoteHost` + one `connect-src` line + CORS `*` on the host;
  optionally serve a pre-patched `tokenizer.json` and drop the shim).
- **P5 — Store:** privacy policy, listing assets (RTL-correct Hebrew screenshots), data-safety form
  ("no data collected"), submit, iterate on review.

**Separate track, own timeline: the PDF in-place redaction spike** (§4). Do not couple it to the
MVP schedule.

## 7. Decisions (all resolved 2026-08-02)

1. **Distribution:** public Chrome Web Store. ✅
2. **UI:** popup — paste text or upload a file, get an anonymized version. ✅
3. **Compute:** fully client-side, no server; PII never leaves the device. ✅
4. **Model hosting:** self-host on our VPS/CDN for production; the spike uses the HF CDN to move
   fast (exact files + switch procedure in §3.3 and `extension/README.md`). ✅
5. **PDF:** in-place redaction is the eventual goal but OUT of the MVP entirely — its own separate
   hard spike (§4). ✅
6. **Restore/re-identify:** out of scope for MVP — anonymize-only (key CSV still produced). ✅
7. **Monetization:** completely free, no account, no server. ✅

Remaining genuinely-open items (small, resolve during P4/P5): the offscreen-document
justification reason for the Store review, and whether to keep the RegExp shim or serve a
patched `tokenizer.json` from the self-host.

## 8. Next concrete step

**Load the built spike in real Chrome** (steps in `extension/README.md`): load unpacked →
open popup → run on the sample text → confirm spans + WASM badge + cache-hit on reopen. That
manual run is the go/no-go on the extension mechanics. On GO → start P1 (engine module).
