/**
 * Real network monitor — turns the "0 בקשות רשת" trust badge from a hardcoded claim into a LIVE,
 * browser-enforced counter (P2W-04). We patch every primitive a page could use to reach the network
 * and increment a counter each time one is invoked. In the deterministic paste/file path the app
 * makes zero requests, so the badge honestly reads 0; if any code (or a compromised dependency) ever
 * tried to phone home, the number would climb in front of the user. Honesty by observation, not by
 * promise (docs/trust.md).
 *
 * Patch once, as early as possible (imported at the top of main.tsx) so nothing slips through before
 * the wrappers are installed. Same-origin static assets (the HTML, JS, CSS, the logo) are fetched by
 * the browser itself, NOT through these JS primitives, so they do not count — only script-initiated
 * requests do, which is exactly what the promise is about.
 *
 * Scope note: this observes the MAIN thread. The engine worker currently makes no network calls; when
 * the NER model load lands (P4-02) it will fetch its model in the worker and must be surfaced there
 * too. Until then, the main-thread count is the whole story.
 */

type Listener = (count: number) => void;

let count = 0;
const listeners = new Set<Listener>();
let installed = false;

function bump(): void {
  count += 1;
  for (const listener of listeners) {
    listener(count);
  }
}

export function getNetworkCount(): number {
  return count;
}

export function subscribeNetwork(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Install the wrappers. Idempotent — safe to call more than once (only the first call patches).
 * Each wrapper counts the request then delegates to the original, so behavior is unchanged.
 */
export function installNetworkMonitor(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (...args: Parameters<typeof fetch>): Promise<Response> => {
    bump();
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
    bump();
    return originalOpen.call(this, method, url, isAsync, username, password);
  };

  if (typeof navigator.sendBeacon === "function") {
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (...args: Parameters<typeof navigator.sendBeacon>): boolean => {
      bump();
      return originalBeacon(...args);
    };
  }

  if (typeof window.WebSocket === "function") {
    const OriginalWebSocket = window.WebSocket;
    // reason: subclassing the native WebSocket preserves its constructor signature and prototype;
    // a plain wrapper function would lose `instanceof` and the static readyState constants.
    class MonitoredWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        bump();
        super(url, protocols);
      }
    }
    window.WebSocket = MonitoredWebSocket as typeof WebSocket;
  }

  if (typeof window.EventSource === "function") {
    const OriginalEventSource = window.EventSource;
    class MonitoredEventSource extends OriginalEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        bump();
        super(url, init);
      }
    }
    window.EventSource = MonitoredEventSource as typeof EventSource;
  }
}
