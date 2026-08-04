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

export interface NerState {
  readonly status: NerStatus;
  /** 0–100, the current file's download progress (for the banner). */
  readonly progress: number;
  /** How many network requests the worker made to download the model (one-time, expected). */
  readonly modelRequests: number;
}

let state: NerState = { status: "idle", progress: 0, modelRequests: 0 };
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
    Comlink.proxy((count: number) => {
      setState({ modelRequests: count });
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
    setState({ status: "ready", progress: 100 });
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
