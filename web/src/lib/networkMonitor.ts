/**
 * Real network monitor — turns the "0 בקשות רשת" trust badge from a hardcoded claim into a LIVE,
 * browser-enforced observation (P2W-04). We patch every primitive a page could use to reach the network
 * and, for each call, count it AND classify its destination: same-origin / model host = expected, any
 * other host = UNEXPECTED (an exfiltration signal the badge surfaces in red). In the deterministic
 * paste/file path the app makes zero requests, so the badge honestly reads 0; if any code (or a
 * compromised dependency) ever tried to phone home, the count climbs and — if it aimed off-policy —
 * the badge alarms with the host. Honesty by observation, not by promise (docs/trust.md).
 *
 * Patch once, as early as possible (imported at the top of main.tsx) so nothing slips through before
 * the wrappers are installed. Same-origin static assets (HTML/JS/CSS, the logo) are fetched by the
 * browser itself, NOT through these JS primitives, so they do not count — only script-initiated
 * requests do, which is exactly what the promise is about.
 *
 * Scope note: this observes the MAIN thread. The engine worker has its own realm and fetch — its
 * one-time model download is monitored + classified separately (worker/workerNetworkMonitor.ts).
 */
import { isAllowedRequest } from "./requestPolicy";

export interface NetworkState {
  /** Total script-initiated requests on this page (must stay 0 on the local paste/file path). */
  readonly count: number;
  /** Requests aimed at a host that is neither same-origin nor a model host — an exfiltration signal. */
  readonly unexpected: number;
  /** The first unexpected host seen, for the badge to name it. */
  readonly unexpectedHost: string | null;
}

let state: NetworkState = { count: 0, unexpected: 0, unexpectedHost: null };
const listeners = new Set<() => void>();
let installed = false;

function urlString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof URL) {
    return value.href;
  }
  if (value && typeof value === "object" && "url" in value && typeof (value as { url: unknown }).url === "string") {
    return (value as { url: string }).url;
  }
  return "";
}

function record(rawUrl: unknown): void {
  const url = urlString(rawUrl);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const ok = isAllowedRequest(url, origin);
  let host: string | null = null;
  if (!ok) {
    try {
      host = new URL(url, origin).hostname;
    } catch {
      host = null;
    }
  }
  state = {
    count: state.count + 1,
    unexpected: state.unexpected + (ok ? 0 : 1),
    unexpectedHost: state.unexpectedHost ?? host,
  };
  for (const listener of listeners) {
    listener();
  }
}

export function getNetworkState(): NetworkState {
  return state;
}

export function subscribeNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Install the wrappers. Idempotent — safe to call more than once (only the first call patches).
 * Each wrapper records the request (count + destination) then delegates to the original, unchanged.
 */
export function installNetworkMonitor(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (...args: Parameters<typeof fetch>): Promise<Response> => {
    record(args[0]);
    return originalFetch(...args);
  };

  // Bind to the 5-arg overload explicitly so `.call` below type-checks against the full signature.
  const originalOpen: (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) => void = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    isAsync: boolean = true,
    username?: string | null,
    password?: string | null,
  ): void {
    record(url);
    return originalOpen.call(this, method, url, isAsync, username, password);
  };

  if (typeof navigator.sendBeacon === "function") {
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (...args: Parameters<typeof navigator.sendBeacon>): boolean => {
      record(args[0]);
      return originalBeacon(...args);
    };
  }

  if (typeof window.WebSocket === "function") {
    const OriginalWebSocket = window.WebSocket;
    // reason: subclassing the native WebSocket preserves its constructor signature and prototype;
    // a plain wrapper function would lose `instanceof` and the static readyState constants.
    class MonitoredWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        record(url);
        super(url, protocols);
      }
    }
    window.WebSocket = MonitoredWebSocket as typeof WebSocket;
  }

  if (typeof window.EventSource === "function") {
    const OriginalEventSource = window.EventSource;
    class MonitoredEventSource extends OriginalEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        record(url);
        super(url, init);
      }
    }
    window.EventSource = MonitoredEventSource as typeof EventSource;
  }
}
