/**
 * Main-thread controller for the Hebrew NER model: a tiny external store the UI subscribes to, plus
 * the actions that drive the worker. It owns three pieces of state the banner + trust badge need:
 * load status, download progress, and the count of model-download network requests (reported by the
 * worker's own fetch monitor, so the badge can show them honestly and separately from the main
 * counter which must stay 0).
 */
import * as Comlink from "comlink";
import { useSyncExternalStore } from "react";
import { getEngine } from "./engineClient";

export type NerStatus = "idle" | "loading" | "ready" | "error";

/**
 * localStorage flag set after the model first loads successfully. transformers.js caches the 185MB
 * model bytes in the browser Cache Storage, so every later page load re-instantiates from cache with
 * NO network re-download — but the load still emits 0→100 progress. This flag lets the banner say
 * "loading from cache" on those warm loads instead of the misleading one-time "~185MB download" copy.
 */
const MODEL_CACHED_KEY = "mechikon:model-cached";
function modelCachedBefore(): boolean {
  try {
    return localStorage.getItem(MODEL_CACHED_KEY) === "1";
  } catch {
    return false;
  }
}
function markModelCached(): void {
  try {
    localStorage.setItem(MODEL_CACHED_KEY, "1");
  } catch {
    // Private mode / storage disabled — the banner just falls back to the first-time copy. Harmless.
  }
}

export interface NerState {
  readonly status: NerStatus;
  /** 0–100, the current file's download progress (for the banner). */
  readonly progress: number;
  /** True when the model was already downloaded in a prior session (warm cache, no re-download). */
  readonly cachedBefore: boolean;
  /** How many network requests the worker made to download the model (one-time, expected). */
  readonly modelRequests: number;
  /** Worker requests to an UNEXPECTED host (should be 0; the badge alarms if not). */
  readonly unexpectedRequests: number;
  /** The first unexpected worker host, for the badge to name it. */
  readonly unexpectedHost: string | null;
}

let state: NerState = {
  status: "idle",
  progress: 0,
  cachedBefore: modelCachedBefore(),
  modelRequests: 0,
  unexpectedRequests: 0,
  unexpectedHost: null,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<NerState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) {
    listener();
  }
}

let networkRegistered = false;
/** Subscribe to the worker's model-download request count (once). */
async function registerNetwork(): Promise<void> {
  if (networkRegistered) {
    return;
  }
  networkRegistered = true;
  await getEngine().onNetwork(
    Comlink.proxy((report: { ok: number; unexpected: number; unexpectedHost: string | null }) => {
      setState({
        modelRequests: report.ok,
        unexpectedRequests: report.unexpected,
        unexpectedHost: report.unexpectedHost,
      });
    }),
  );
}

let loadStarted = false;
/**
 * Kick off the one-time model load (idempotent). Safe to call on every anonymize — only the first
 * call actually loads. Progress + status flow into the store for the banner.
 */
export async function loadNer(): Promise<void> {
  await registerNetwork();
  if (loadStarted) {
    return;
  }
  loadStarted = true;
  setState({ status: "loading", progress: 0 });
  try {
    await getEngine().loadNer(
      Comlink.proxy((event: unknown) => {
        const progressEvent = event as { status?: string; progress?: number };
        if (progressEvent?.status === "progress" && typeof progressEvent.progress === "number") {
          setState({ progress: Math.round(progressEvent.progress) });
        }
      }),
    );
    markModelCached();
    setState({ status: "ready", progress: 100, cachedBefore: true });
  } catch {
    loadStarted = false; // allow a retry
    setState({ status: "error" });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): NerState {
  return state;
}

/** Reactive NER state for components. */
export function useNer(): NerState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
