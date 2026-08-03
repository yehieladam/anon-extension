/**
 * TEMPORARY — a direct port of extension/popup.js's pipeline call, kept only long enough to
 * prove this build reaches parity with the frozen spike (P2-01's Definition of Done).
 *
 * P1-11 replaces it with the real engine wrapper (engine/src/ner.ts), which adds the two
 * things deliberately missing here: reconstructed character offsets and `##` wordpiece
 * re-joining. Until then this reproduces the spike's raw output faithfully, artifacts and
 * all — including `start`/`end` coming back null, which S-01 confirmed on all 19 spans.
 *
 * Delete this file when ner.ts lands.
 */
import { pipeline, type TokenClassificationPipeline } from "@huggingface/transformers";
import { installTokenizerShim } from "@engine/index";
import { configureOrtRuntime } from "./ortSetup";

const MODEL_ID = "onnx-community/dictabert-ner-ONNX";
const DTYPE = "q8"; // int8 quantized -> onnx/model_quantized.onnx (~185 MB)

export type Backend = "webgpu" | "wasm";

/** One raw span exactly as the spike renders it. */
export interface ParitySpan {
  readonly entityGroup: string;
  readonly word: string;
  readonly score: number;
  /** Null until P1-11 reconstructs offsets — a known Phase-0 artifact, not a bug. */
  readonly start: number | null;
  readonly end: number | null;
}

export interface NerRun {
  readonly backend: Backend;
  readonly loadMs: number;
  readonly inferMs: number;
  readonly spans: readonly ParitySpan[];
}

export interface LoadProgress {
  readonly loadedBytes: number;
  readonly totalBytes: number;
}

type ProgressHandler = (progress: LoadProgress) => void;

interface ProgressEvent {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
}

let pipelinePromise: Promise<{ pipe: TokenClassificationPipeline; backend: Backend }> | null = null;
let loadMs = 0;

/**
 * Sum progress across the four files the model download fetches (config.json,
 * tokenizer_config.json, tokenizer.json, onnx/model_quantized.onnx — the exact list S-01
 * recorded), so the UI can show one bar rather than four.
 */
function trackProgress(onProgress: ProgressHandler) {
  const perFile = new Map<string, { loaded: number; total: number }>();
  return (event: ProgressEvent) => {
    if (event.status !== "progress" || !event.file) return;
    perFile.set(event.file, { loaded: event.loaded ?? 0, total: event.total ?? 0 });
    let loadedBytes = 0;
    let totalBytes = 0;
    for (const file of perFile.values()) {
      loadedBytes += file.loaded;
      totalBytes += file.total;
    }
    // A cache hit still emits one final 100% event per file. Reporting that would flash
    // "Downloading… 189 / 189 MB" on every warm open, which is simply untrue.
    if (totalBytes > 0 && loadedBytes < totalBytes) onProgress({ loadedBytes, totalBytes });
  };
}

async function createPipeline(
  device: Backend,
  onProgress: ProgressHandler,
): Promise<TokenClassificationPipeline> {
  return pipeline("token-classification", MODEL_ID, {
    device,
    dtype: DTYPE,
    progress_callback: trackProgress(onProgress),
  });
}

/**
 * Whether WebGPU can actually produce an adapter.
 *
 * `navigator.gpu` being present is NOT enough: Chrome exposes the object even when the GPU
 * is disabled or no adapter can be created. The spike checked only for presence and relied
 * on a try/catch around pipeline() to fall back — which does not work, because a failed
 * webgpu construction poisons the retry and transformers.js reports "no available backend
 * found" instead of quietly using WASM. Probing first means we never start down that path.
 * Found by the P2-01 verification run with the GPU disabled; the same latent bug is in
 * extension/popup.js, which is frozen and will be retired rather than patched.
 */
async function hasUsableWebGpu(): Promise<boolean> {
  const gpu = navigator.gpu;
  if (!gpu?.requestAdapter) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/**
 * Lazy singleton. WebGPU is used opportunistically and WASM is the fallback — Phase 0
 * measured WASM winning on an integrated Intel GPU, while S-01 saw WebGPU win on Apple
 * Silicon, so neither is the universal default and the probe does the deciding.
 */
function getPipeline(onProgress: ProgressHandler, forceBackend?: Backend) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      installTokenizerShim();
      configureOrtRuntime();

      const backend: Backend =
        forceBackend ?? ((await hasUsableWebGpu()) ? "webgpu" : "wasm");
      const startedAt = performance.now();
      const pipe = await createPipeline(backend, onProgress);
      loadMs = Math.round(performance.now() - startedAt);
      return { pipe, backend };
    })().catch((error: unknown) => {
      pipelinePromise = null; // allow a retry after a failed load
      throw error;
    });
  }
  return pipelinePromise;
}

/** Run token classification over `text`, returning the spike's raw span shape. */
export async function runNer(
  text: string,
  onProgress: ProgressHandler,
  forceBackend?: Backend,
): Promise<NerRun> {
  const { pipe, backend } = await getPipeline(onProgress, forceBackend);

  const startedAt = performance.now();
  const output = await pipe(text, { aggregation_strategy: "simple" });
  const inferMs = Math.round(performance.now() - startedAt);

  const raw = Array.isArray(output) ? output : [output];
  const spans: ParitySpan[] = raw.map((span) => ({
    entityGroup: String(span.entity_group ?? span.entity ?? ""),
    word: String(span.word ?? ""),
    score: Number(Number(span.score ?? 0).toFixed(4)),
    start: span.start ?? null,
    end: span.end ?? null,
  }));

  return { backend, loadMs, inferMs, spans };
}
