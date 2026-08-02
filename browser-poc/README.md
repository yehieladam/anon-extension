# Browser NER PoC (Phase 0)

Isolated feasibility spike: run Hebrew NER (`onnx-community/dictabert-ner-ONNX`)
entirely in the browser with transformers.js. No build step, no server-side
inference — a single static `index.html`. Nothing here touches `src/` or the
deployed app.

## Pinned dependency

```js
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
```

- Package: `@huggingface/transformers` (the renamed successor of `@xenova/transformers`).
- Version pinned to **4.2.0** (latest at time of writing). Verified: the bare
  jsdelivr URL serves `dist/transformers.min.js`, which is an ES module
  exporting `pipeline`.
- **v4 is required, not optional:** `aggregation_strategy: 'simple'` on the
  token-classification pipeline exists only in v4. In v3.x (up to 3.8.1) the
  pipeline only supports `ignore_labels` and returns ungrouped per-token
  entities.

## Model

`onnx-community/dictabert-ner-ONNX` — `BertForTokenClassification`, Hebrew NER
(labels: PER, ORG, GPE, LOC, FAC, TIMEX, TTL, EVE, WOA, DUC, ANG, MISC,
INFORMAL). ONNX weights available on the HF repo:

| File | Size | dtype flag |
|---|---|---|
| `onnx/model.onnx` | 735 MB | `fp32` |
| `onnx/model_fp16.onnx` | 368 MB | `fp16` |
| `onnx/model_quantized.onnx` | **185 MB** | **`q8` (used here)** |
| `onnx/model_int8.onnx` | 185 MB | `int8` |
| `onnx/model_uint8.onnx` | 185 MB | `uint8` |
| `onnx/model_q4.onnx` | 449 MB | `q4` |
| `onnx/model_q4f16.onnx` | 246 MB | `q4f16` |

Plus `tokenizer.json` (~3.6 MB). The page pins `dtype: 'q8'` explicitly so both
WebGPU and WASM load the same 185 MB quantized file (WebGPU would otherwise
default to fp32 = 735 MB). First run downloads ~189 MB to the browser cache;
subsequent loads are served from cache.

## How to run

ES modules and model fetches do not work from `file://` — serve over HTTP:

```
cd browser-poc
python -m http.server 8000
```

Then open http://localhost:8000/ in Chrome/Edge, click **Run NER**. First run
shows a download progress bar; after that the model loads from cache.

## Backend selection (WebGPU vs WASM)

The page tries `device: 'webgpu'` first (only if `navigator.gpu` exists) and
falls back to `device: 'wasm'` on any init failure. The backend that actually
ran is shown in the UI badge and in the result object.

**Caveat for automated measurement:** headless Chromium (Playwright/Puppeteer
defaults) usually has no WebGPU, so a headless harness measures the WASM path.
Real desktop Chrome measures WebGPU. Compare both if the WebGPU number matters.
(Headed Chrome via Playwright, or headless with
`--enable-unsafe-webgpu --enable-features=Vulkan`, can sometimes get WebGPU.)

## Harness hooks

For headless measurement without screen-scraping:

- `await window.runNer(text)` — loads the pipeline lazily (once, reused across
  calls) and resolves to the result object.
- `window.__NER_RESULT` — set after every run:
  `{ backend, loadMs, inferMs, spans: [{ entity_group, word, score, start, end }] }`.
- `<pre id="result-json">` — hidden element containing the same JSON.
- `window.__POC_READY` — true once the module script has evaluated.

`loadMs` is the one-time pipeline construction + download time; `inferMs` is
pure inference (measured with `performance.now()` around the pipeline call,
excluding model load).

## Known risks / notes

- `@huggingface/transformers` v4 is a recent major (uses onnxruntime-web 1.26
  dev build). If anything misbehaves at runtime, there is no v3 escape hatch
  with grouped entities — a manual BIO-grouping shim over v3 output would be
  needed instead.
- `word` strings from WordPiece aggregation may contain extra spaces around
  Hebrew punctuation/hyphens (e.g. `דוד בן - גוריון`); use `start`/`end`
  offsets, not the `word` text, when mapping back to the source.
- Model download is ~189 MB on first visit — fine for a PoC, a real product
  would need a loading UX and possibly the q4f16 (246 MB) or a distilled model
  evaluated for quality/size tradeoff.
