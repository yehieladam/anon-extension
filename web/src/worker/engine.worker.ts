/**
 * Engine Web Worker — runs the framework-free engine off the UI thread (P0I-01). Comlink exposes an
 * async API; the app never touches the engine on the main thread, so a large document never freezes
 * the UI. Everything here is local — the worker makes no network calls (NER + its model load are
 * added later behind an explicit, lazy step).
 */
import * as Comlink from "comlink";
// Import from specific engine modules, NOT the @engine/index barrel — the barrel re-exports ner.ts
// (which pulls transformers.js + onnxruntime's 23 MB wasm). Keeping NER out of this graph is what
// makes the deterministic path instant and lets the model lazy-load only when NER is used (P0I-02).
import { anonymizeDeterministic } from "@engine/pipeline";
import { restore } from "@engine/restore";
import type { AnonymizeResult } from "@engine/types";
import type { KeyRow } from "@engine/types";
import type { RestoreResult } from "@engine/restore";
import { redactFile, type FileRedaction } from "./officeRedact";

const api = {
  /** Detect (deterministic) → resolve → anonymize. Instant, no model. */
  anonymize(text: string): AnonymizeResult {
    return anonymizeDeterministic(text);
  },
  /**
   * Process an uploaded file: overlay-redact the ORIGINAL (docx/xlsx keep logo/layout; txt/csv plain)
   * and return both the detection result and the redacted bytes to download. pdf/xls detect only.
   */
  redactFile(fileName: string, buffer: ArrayBuffer): Promise<FileRedaction> {
    return redactFile(fileName, buffer);
  },
  /** Put original values back using the key (tolerant matcher). */
  restore(text: string, key: readonly KeyRow[]): RestoreResult {
    return restore(text, key);
  },
};

export type EngineApi = typeof api;

Comlink.expose(api);
