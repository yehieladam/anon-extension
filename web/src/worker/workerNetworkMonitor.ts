/**
 * Worker-side network monitor. The main-thread monitor (lib/networkMonitor.ts) cannot see requests a
 * Web Worker makes — a worker has its own realm and its own `fetch`. The ONLY network the worker ever
 * does is the one-time model download (transformers.js fetching the ONNX + tokenizer). Hard rule 2
 * says that download is the single permitted request and it must be surfaced, not hidden: the trust
 * badge shows the main counter honestly at 0 AND a separate "model download: N (one-time)" line.
 *
 * We patch `self.fetch` at the very top of the worker, before any dynamic import can fetch, and report
 * each request to a listener the main thread registers over Comlink. Idempotent.
 */

type WorkerFetchListener = (count: number) => void;

interface MonitoredGlobal {
  __workerNetPatched?: boolean;
}

let count = 0;
let listener: WorkerFetchListener | null = null;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/** Patch `self.fetch` to count worker requests and notify the listener. Call first thing. */
export function installWorkerNetworkMonitor(): void {
  const scope = globalThis as typeof globalThis & MonitoredGlobal;
  if (scope.__workerNetPatched || typeof scope.fetch !== "function") {
    return;
  }
  scope.__workerNetPatched = true;

  const originalFetch = scope.fetch.bind(scope);
  scope.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    count += 1;
    void urlOf(input); // kept for future per-host reporting; the count is what the badge needs
    listener?.(count);
    return originalFetch(input, init);
  };
}

/** Register the main thread's callback (Comlink-proxied). Immediately replays the current count. */
export function onWorkerNetwork(callback: WorkerFetchListener): void {
  listener = callback;
  callback(count);
}
