// MV3 popup — Hebrew NER spike.
//
// Everything runs locally in this popup page:
// - transformers.js is vendored (vendor/transformers.min.js) — MV3 forbids remote code.
// - onnxruntime-web's WASM loader + binary are vendored too, and wasmPaths is
//   overridden below. Without the override, transformers.js v4 defaults wasmPaths
//   to the jsdelivr CDN, and loading that remote .mjs would be blocked by the
//   extension CSP (script-src 'self').
// - The MODEL is data, not code: for the spike it is fetched from the HF CDN on
//   first use (~185 MB, allowed by connect-src in manifest.json) and cached by
//   transformers.js in the extension origin's Cache API. Production self-hosts
//   the same files (see extension/README.md).
import { pipeline, env } from './vendor/transformers.min.js';

const MODEL_ID = 'onnx-community/dictabert-ner-ONNX';
const DTYPE = 'q8'; // int8 quantized -> onnx/model_quantized.onnx (~185 MB)

const el = (id) => document.getElementById(id);
const statusEl = el('status');
const progressWrap = el('progress-wrap');
const progressBar = el('progress-bar');

// ---- local ORT runtime (MV3: no remote code) ----
// Phase 0 ran through the same asyncify build (transformers.js's default choice
// for Chrome), so behavior is identical — just served from the extension itself.
// Fail LOUDLY if the wasm env is missing: silently skipping would let the bundle
// fall back to its jsdelivr default, which the extension CSP then blocks with a
// confusing error much later.
const ortWasmEnv = env.backends && env.backends.onnx && env.backends.onnx.wasm;
if (ortWasmEnv) {
  ortWasmEnv.wasmPaths = {
    mjs: new URL('vendor/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
    wasm: new URL('vendor/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
  };
  // Extension pages are not crossOriginIsolated (no SharedArrayBuffer), so ORT
  // would fall back to 1 thread anyway; pin it so the Worker path is never taken
  // (blob: workers are blocked under MV3 CSP). Matches Phase-0 measurements.
  ortWasmEnv.numThreads = 1;
} else {
  statusEl.textContent =
    'Error: onnxruntime wasm env not found — cannot point the runtime at the ' +
    'vendored WASM files. (env.backends.onnx.wasm is missing in this build.)';
}

// ---- model loading (lazy singleton, WebGPU -> WASM fallback) ----

let pipePromise = null;
let backend = null;
let loadMs = 0;

const fileProgress = new Map(); // file -> { loaded, total }

function onProgress(evt) {
  if (evt.status === 'progress' && evt.file) {
    fileProgress.set(evt.file, { loaded: evt.loaded || 0, total: evt.total || 0 });
    let loaded = 0;
    let total = 0;
    for (const p of fileProgress.values()) { loaded += p.loaded; total += p.total; }
    if (total > 0) {
      const pct = Math.min(100, (loaded / total) * 100);
      progressWrap.style.display = 'block';
      progressBar.style.width = pct.toFixed(1) + '%';
      statusEl.textContent =
        'Downloading model (one-time)… ' + (loaded / 1e6).toFixed(0) + ' / ' +
        (total / 1e6).toFixed(0) + ' MB — keep this popup open';
    }
  } else if (evt.status === 'ready') {
    progressWrap.style.display = 'none';
  }
}

async function createPipeline(device) {
  return pipeline('token-classification', MODEL_ID, {
    device,
    dtype: DTYPE,
    progress_callback: onProgress,
  });
}

function getPipeline() {
  if (!pipePromise) {
    pipePromise = (async () => {
      const t0 = performance.now();
      let pipe = null;
      // Phase-0 finding: WASM beats WebGPU on integrated GPUs, so WASM is the
      // default. WebGPU is attempted only opportunistically when available.
      if (navigator.gpu) {
        try {
          statusEl.textContent = 'Loading model (WebGPU)…';
          pipe = await createPipeline('webgpu');
          backend = 'webgpu';
        } catch (err) {
          console.warn('WebGPU init failed, falling back to WASM:', err);
        }
      }
      if (!pipe) {
        statusEl.textContent = 'Loading model (WASM)…';
        pipe = await createPipeline('wasm');
        backend = 'wasm';
      }
      loadMs = Math.round(performance.now() - t0);
      progressWrap.style.display = 'none';
      statusEl.textContent = 'Model ready (' + backend + ', load ' + loadMs + ' ms).';
      return pipe;
    })().catch((err) => {
      pipePromise = null; // allow retry
      throw err;
    });
  }
  return pipePromise;
}

// ---- inference ----

async function runNer(text) {
  const ner = await getPipeline();
  const t0 = performance.now();
  const output = await ner(text, { aggregation_strategy: 'simple' });
  const inferMs = Math.round(performance.now() - t0);

  const spans = output.map((s) => ({
    entity_group: s.entity_group,
    // Known v4.2.0 artifact (Phase 0): start/end are null and hyphenated words
    // keep "##" wordpiece markers. The engine port (P1/P2) reconstructs offsets;
    // the spike only needs to show that spans come out at all.
    word: s.word,
    score: Number(s.score.toFixed(4)),
    start: s.start ?? null,
    end: s.end ?? null,
  }));

  const result = { backend, loadMs, inferMs, spans };
  // Expose for debugging via popup DevTools console.
  window.__NER_RESULT = result;
  return result;
}

// ---- UI ----

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderResult(result) {
  el('backend-badge').textContent = result.backend.toUpperCase();
  el('timing').textContent =
    'Model load: ' + result.loadMs + ' ms (one-time) · Inference: ' + result.inferMs +
    ' ms · ' + result.spans.length + ' spans';
  el('meta').style.display = 'block';

  const resultsEl = el('results');
  if (result.spans.length === 0) {
    resultsEl.innerHTML = '<p class="empty">No entities detected.</p>';
    return;
  }
  const rows = result.spans.map((s) =>
    '<tr>' +
    '<td><span class="entity-tag">' + escapeHtml(s.entity_group) + '</span></td>' +
    '<td>' + escapeHtml(s.word) + '</td>' +
    '<td class="num">' + s.score.toFixed(3) + '</td>' +
    '</tr>'
  ).join('');
  resultsEl.innerHTML =
    '<table><thead><tr><th>entity_group</th><th>word</th><th>score</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}

const runBtn = el('run-btn');
runBtn.addEventListener('click', async () => {
  const text = el('input').value.trim();
  if (!text) return;
  runBtn.disabled = true;
  try {
    const result = await runNer(text);
    renderResult(result);
    statusEl.textContent = 'Done (' + result.backend + ').';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Error: ' + (err && err.message ? err.message : String(err));
  } finally {
    runBtn.disabled = false;
  }
});
