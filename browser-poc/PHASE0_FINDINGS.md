# Phase 0 — in-browser Hebrew NER spike: findings & verdict

**Date:** 2026-07-30. **Verdict: GO.** q8-quantized `onnx-community/dictabert-ner-ONNX`
runs in the browser at recall parity with the current server model. Two engineering blockers
were found and are both solvable (one already fixed in the spike).

## What was measured

- **Model:** `onnx-community/dictabert-ner-ONNX`, dtype `q8` (int8), ~185 MB one-time download.
- **Runtime:** transformers.js `@huggingface/transformers@4.2.0` (v4 mandatory — v3 lacks
  `aggregation_strategy`), token-classification pipeline, WebGPU→WASM fallback.
- **Test set:** the SAME `ner_testset.json` used for the server baseline — 21 sentences,
  54 hand-labeled gold spans (PERSON/ORG/LOCATION). Same containment match rule.
- **Harness:** `scratchpad/ner_harness.mjs` drove the page in local Chromium (playwright-core),
  called `window.runNer()` per sentence, mapped tags server-style (PER→PERSON,
  ORG→ORGANIZATION, GPE/LOC/FAC→LOCATION), compared to `server_baseline.json`.

## Recall: browser q8 vs server

| Type | Server | Browser (raw) | Browser (##-artifact-adjusted) |
|---|---|---|---|
| PERSON | 95.00% (19/20) | 80.00% (16/20) | **95.00% (19/20)** |
| ORGANIZATION | 77.78% (14/18) | 72.22% (13/18) | **77.78% (14/18)** |
| LOCATION | 93.75% (15/16) | 93.75% (15/16) | **93.75% (15/16)** |
| **OVERALL** | **88.89% (48/54)** | 81.48% (44/54) | **88.89% (48/54)** |

The raw browser number (81.48%) is depressed ONLY by a wordpiece surface artifact, not by
quantization. The 4 gaps vs server were all hyphenated names — `רחל לוי-אברמוביץ`,
`נועה בר-אילן`, `יצחק נבון-לוי`, `אוניברסיטת בן-גוריון` — where the model DID detect the
entity (head token found) but the returned surface string was truncated at the `##` wordpiece
continuation (e.g. `"רחל לוי ##-"`). Adjust for that one artifact and browser == server span
for span. Every remaining "miss" is a sentence the SERVER also missed (אלביט מערכות; שיבא/רמב"ם
detected as LOCATION not ORG via FAC→LOCATION; עיריית הרצליה+גבי סמו zero-detect).

**Conclusion: q8 quantization does not meaningfully hurt Hebrew NER recall.** The original
Phase-0 risk ("does quantization lose recall?") is retired: NO.

## Blockers found

### 1. Tokenizer regex is illegal under `/u` (FIXED in the spike)
dictabert's pretokenizer regex contains `\"` and `\'` (Hebrew gershayim/geresh in abbreviations
like `ח"פ`, `ת"ז`). transformers.js compiles the pretokenizer with the `u` flag, under which
`\"` is `Invalid escape` → V8 rejects the RegExp and **NER never runs** (all 21 sentences errored
before inference). Fixed with a ~30-line classic-script shim at the top of `index.html` that
strips illegal ASCII escapes from `u/v`-flagged patterns only. After the shim: model runs, recall
as above. The real React port needs the same shim (or a patched, self-hosted `tokenizer.json`).

### 2. transformers.js returns NULL char offsets + `##` in surface (SOLVABLE, needed for the port)
With `aggregation_strategy:'simple'`, v4.2.0 returned `start=end=null` on every span and left
`##` wordpiece markers in `word`. Server-side Python transformers returns clean offsets, which
is why the server has no `##` problem. The port must reconstruct offsets (align spans to source
text) and strip `##`/re-join hyphenated wordpieces so placeholders land on the full entity. This
is the one real piece of NER-porting work Phase 2 must budget for — tractable, not a blocker.

## Speed — measured on real hardware (headed Chromium, Intel Iris Xe iGPU)

Steady-state per-line inference (12 runs, median), model in persistent cache:

| Doc | Browser WASM | Browser WebGPU | Server (2-core VPS) |
|---|---|---|---|
| per line | **74 ms** | 317 ms | ~730 ms |
| 20 lines | **1.5 s** | 6.3 s | 14.6 s |
| 60 lines | **4.4 s** | 19 s | 24.5 s |

**Key, non-obvious finding: WASM (CPU) beats WebGPU on this integrated Intel GPU** — 74 ms vs
317 ms/line. For a small BERT on short sequences, GPU dispatch overhead dominates and an iGPU is
weak; onnxruntime-web WASM+SIMD wins. Known transformers.js reality. WebGPU is only a win on
strong discrete GPUs / Apple Silicon, so the client-side build should **default to WASM** and treat
WebGPU as an opportunistic bonus, not the primary path.

**The browser is ~10x faster than the current server** on a typical doc (1.5 s vs 14.6 s) — same
CPU class, but the browser runs the **q8 (int8)** model via onnxruntime-web while the server runs
**fp32** via torch. int8 on a modern CPU runtime ≈ 10x. Caveats: numbers are naive linear
extrapolation from single-line steady state (a batched port would likely be faster); first doc
also pays a one-time ~40 s model load (185 MB download + compile), cached thereafter; the static
`http.server` sent no COOP/COEP so WASM ran without multi-threading — threads could make it faster.

**Bonus implication:** converting the CURRENT server model to ONNX int8 would also speed the live
VPS tool several-fold without the full rewrite (the earlier "option #1", now backed by numbers).
Bench data: `browser-poc/speed_bench.json`.

## How to reproduce
```
# server baseline (Python, from repo root):
venv\Scripts\activate
python browser-poc\run_server_baseline.py

# browser run (from repo root):
cd browser-poc && python -m http.server 8777      # serve statically (ES modules need http)
# then, from scratchpad: PORT=8777 node ner_harness.mjs
# OR just open http://localhost:8777/index.html in real Chrome and click Run (measures WebGPU).
```

## Recommendation
Proceed to **Phase 1** (port deterministic regex+checksum recognizers to JS — covers most Israeli
PII, zero server load) and **Phase 2** (NER port with the offset/`##` handling above). Keep the
current Streamlit portal tool untouched in production; the client-side build is a separate track.
