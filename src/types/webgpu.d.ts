/**
 * Minimal WebGPU surface: this shell only ever probes whether a usable adapter exists
 * before letting transformers.js try the webgpu device. Declared locally rather than
 * adding @webgpu/types for one probe (CLAUDE.md — no dependency without a reason).
 *
 * Widen to the real types if we ever touch the GPU API directly.
 */
interface Navigator {
  /** Present when the browser exposes WebGPU — presence does NOT imply a usable adapter. */
  readonly gpu?: {
    /** Resolves null (or rejects) when no adapter is available, e.g. GPU disabled. */
    requestAdapter?: () => Promise<unknown>;
  };
}
