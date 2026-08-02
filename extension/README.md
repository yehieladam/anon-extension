# MV3 extension spike — Hebrew NER fully client-side

This folder is a minimal, loadable **Manifest V3 Chrome extension**. Its only job is to
answer one question:

> Does the client-side dictabert NER (proven in `browser-poc/`, Phase 0) also run inside a
> real MV3 extension popup, under the MV3 CSP (no remote code, `'wasm-unsafe-eval'`), with
> the model cached in the extension origin?

It is NOT the product. No regex recognizers, no anonymized output, no file upload, no
design polish — those come in later phases per `docs/chrome-extension-plan.md`. It pastes
Hebrew text into dictabert-ner (ONNX, q8, int8) via transformers.js v4.2.0 and shows the
detected entity spans, which backend ran (wasm/webgpu), and the inference time.

## How to test (Windows, real Chrome)

1. Open Chrome and go to `chrome://extensions`.
2. Turn ON **Developer mode** (toggle, top-right).
3. Click **Load unpacked** and select this folder:
   `C:\Users\yehie\Desktop\pii-anonymizer-spike\extension`
4. Click the extensions puzzle-piece icon in the toolbar, pin
   **Hebrew PII Anonymizer (spike)**, then click its (terracotta) icon.
5. The popup opens with Hebrew sample text prefilled. Click **Anonymize (detect entities)**.
6. **First run only:** the model (~185 MB) downloads from the Hugging Face CDN with a
   progress bar. This takes a few minutes on a normal connection.
   **Important:** a popup closes the moment you click anywhere outside it, which aborts
   the download — use the **"open in a tab"** link at the top of the popup and run it
   there the first time. After the first download the model is cached; later opens load
   from cache in a few seconds and work fully offline.

### What success looks like

- A table of entity spans appears, e.g. `PER / דוד לוי`, `ORG / בנק הפועלים`,
  `GPE / תל אביב` (tags are the model's raw groups: PER, ORG, GPE, LOC, FAC, …),
  each with a confidence score.
- A badge shows which backend ran — expect **WASM** on most machines (Phase-0 finding:
  WASM beats WebGPU on integrated GPUs; WebGPU is only tried opportunistically).
- Timing line shows model load (one-time per popup open) and inference ms
  (Phase-0 steady state was ~74 ms per line on WASM).
- Close the popup, reopen, run again — no re-download (loads from cache).

If instead you see a CSP error, a failed fetch, or "NER never runs", that is exactly the
kind of MV3-specific failure this spike exists to surface — open DevTools on the popup
(right-click inside the popup → Inspect) and check the Console; `window.__NER_RESULT`
holds the last result.

### Sanity-checking quality

Paste sentences from `browser-poc/ner_testset.json` — expected spans are in its `gold`
fields. Known Phase-0 artifacts (NOT bugs in this spike, handled later in the engine
port): `start`/`end` come back `null`, and hyphenated names may show `##` wordpiece
markers (e.g. `לוי ##-אברמוביץ`).

## Files

| File | What it is |
|---|---|
| `manifest.json` | MV3 manifest. No permissions at all. CSP: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co;` |
| `popup.html` | The popup: textarea (prefilled Hebrew), run button, results table. Loads `shim.js` (classic) then `popup.js` (module). |
| `shim.js` | The Phase-0 RegExp shim, as a separate file (MV3 forbids inline scripts). Strips `\"`/`\'` escapes that are illegal under the `/u` flag so dictabert's pretokenizer regex compiles. Must run before transformers.js builds the tokenizer. |
| `popup.js` | Loads the vendored transformers.js, points onnxruntime at the vendored WASM files, runs `pipeline('token-classification', 'onnx-community/dictabert-ner-ONNX', { dtype: 'q8' })` with `aggregation_strategy: 'simple'`, renders spans. |
| `vendor/transformers.min.js` | `@huggingface/transformers@4.2.0` ESM dist, vendored (v4 mandatory — v3 lacks `aggregation_strategy`). From `https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js`. |
| `vendor/ort-wasm-simd-threaded.asyncify.{mjs,wasm}` | onnxruntime-web runtime (`1.26.0-dev.20260416-b7804b056c`, the exact version transformers 4.2.0 pins). Vendored because transformers.js otherwise loads them from jsdelivr at runtime — the `.mjs` is remote CODE, blocked by MV3 CSP. From `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/`. |
| `icons/icon{16,48,128}.png` | Placeholder solid-color icons (real branding later). |

## Model hosting: spike vs production

- **Spike (this folder):** model files are fetched from the Hugging Face CDN
  (`huggingface.co`, which redirects downloads to `*.hf.co` — both are in `connect-src`).
- **Production:** self-host the same files on our VPS/CDN and change `connect-src` to that
  single host (plus point transformers.js at it via `env.remoteHost`). Files to mirror
  from `onnx-community/dictabert-ner-ONNX`:
  `config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/model_quantized.onnx`
  (~185 MB). Confirm the exact request list once in the popup's DevTools Network tab on a
  cold load before mirroring. Self-hosting also lets us ship a pre-patched
  `tokenizer.json` (no `\"`/`\'` escapes) and eventually drop the RegExp shim.

## Model caching

transformers.js caches downloaded model files with the **Cache API** in the extension's
own origin (`chrome-extension://<id>`), which persists across popup opens and browser
restarts. Verify: popup DevTools → Application → Cache Storage → `transformers-cache`.
Clearing the extension (remove/re-add) clears the cache and re-triggers the download.

## MV3 wrinkles this spike encodes (and known limits)

1. **No remote code** — transformers.js AND the onnxruntime `.mjs`/`.wasm` are vendored;
   `env.backends.onnx.wasm.wasmPaths` is overridden to the local files (otherwise the
   bundle defaults to jsdelivr and CSP kills it with a late, confusing error).
2. **`'wasm-unsafe-eval'`** is required in `content_security_policy.extension_pages` for
   onnxruntime-web to compile WASM.
3. **Inline scripts are forbidden** — the RegExp shim is a separate classic-script file
   loaded before the module.
4. **Single-threaded WASM pinned** (`numThreads = 1`): extension pages are not
   crossOriginIsolated, and ORT's multithread path spawns blob workers that MV3 CSP
   blocks. Matches the Phase-0 performance numbers (which were also single-threaded).
5. **Popup lifetime** — the popup dies on any outside click, killing an in-flight model
   download and re-initializing the pipeline on every open (cached load = a few seconds).
   The plan's fix is an offscreen document (keeps the pipeline warm) and/or prefetching
   the model on install; out of scope for the spike, the "open in a tab" link is the
   stopgap.
6. **No permissions** — the manifest requests none. Model fetch works because
   huggingface.co serves CORS `Access-Control-Allow-Origin: *`; a production self-host
   must send the same header (or be added to `host_permissions`).

## What is honestly NOT proven until a real Chrome load

Everything here is syntax-validated and the vendored bundle import-checked in Node, but
no real browser ran it in this environment. The single manual step above (load unpacked,
click the button) is the actual go/no-go test for: CSP acceptance, WASM compile in a
popup, model download + Cache API persistence in the extension origin, and the shim
firing before tokenizer build inside an extension page.
