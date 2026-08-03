/**
 * Point onnxruntime-web at the runtime files packaged inside this extension.
 *
 * This lives in the shell, not in engine/, because it needs chrome.runtime.getURL to build
 * an absolute chrome-extension:// URL — the popup document sits at src/popup/index.html in
 * the build output, so a relative path would be brittle. chrome.* is banned in the engine
 * (CLAUDE.md hard rule 4), which settles the layering.
 *
 * The files themselves are copied into dist/ort/ by the copyOrtRuntime plugin in
 * vite.config.ts.
 */
import { env } from "@huggingface/transformers";

const ORT_DIR = "ort";

/** Thrown when the transformers build has no ORT wasm backend to configure. */
export class OrtSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrtSetupError";
  }
}

/**
 * Must run before the first `pipeline(...)` call. Fails loudly rather than silently
 * skipping: without the override transformers.js falls back to its jsdelivr default, and
 * MV3 CSP then blocks that remote .mjs with a confusing error much later (the exact trap
 * documented in docs/chrome-extension-plan.md section 3).
 */
export function configureOrtRuntime(): void {
  const wasmBackend = env.backends?.onnx?.wasm;
  if (!wasmBackend) {
    throw new OrtSetupError(
      "onnxruntime wasm env not found (env.backends.onnx.wasm is missing in this build) — " +
        "cannot point the runtime at the packaged WASM files.",
    );
  }

  // reason: transformers.js types wasmPaths as a string prefix, but onnxruntime-web also
  // accepts a per-file record, which is what we need to name two packaged files.
  (wasmBackend as { wasmPaths: unknown }).wasmPaths = {
    mjs: chrome.runtime.getURL(`${ORT_DIR}/ort-wasm-simd-threaded.asyncify.mjs`),
    wasm: chrome.runtime.getURL(`${ORT_DIR}/ort-wasm-simd-threaded.asyncify.wasm`),
  };

  // Extension pages are not crossOriginIsolated (no SharedArrayBuffer), so ORT would fall
  // back to one thread anyway. Pinning it means the Worker path is never taken — MV3 CSP
  // blocks the blob: workers that path spawns.
  wasmBackend.numThreads = 1;
}
