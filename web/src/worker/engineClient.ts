/**
 * Main-thread handle to the engine worker (P0I-01). Lazily spawns a single module worker and wraps
 * it with Comlink so the app calls `getEngine().anonymize(text)` as if it were local — but it runs
 * off the UI thread.
 */
import * as Comlink from "comlink";
import type { EngineApi } from "./engine.worker";

let proxy: Comlink.Remote<EngineApi> | null = null;

export function getEngine(): Comlink.Remote<EngineApi> {
  if (!proxy) {
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), {
      type: "module",
      name: "mechikon-engine",
    });
    proxy = Comlink.wrap<EngineApi>(worker);
  }
  return proxy;
}
