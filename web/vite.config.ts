import { fileURLToPath, URL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Mechikon web app — a SEPARATE build from the extension (own Vercel project on the
 * mechikon.bai-solutions subdomain). Reuses `@engine/*` unchanged.
 *
 * COOP/COEP make the served page `crossOriginIsolated`, which lets onnxruntime-web use
 * multi-threaded WASM for faster NER (Phase-0). These headers are set for dev + preview here;
 * production is served with the same headers via web/vercel.json.
 */
const COOP = "same-origin";
const COEP = "require-corp";

/**
 * Strict CSP — the browser-enforced backbone of the "nothing leaves the device" promise (TR-01).
 * `connect-src` is locked to self + the model host so PII cannot be exfiltrated even if a bundled
 * dependency were compromised. `wasm-unsafe-eval` is needed by onnxruntime-web; `worker-src blob:`
 * for its workers. When the model self-hosts on R2 (P4-02), collapse `connect-src` to `'self'`.
 * Keep this in sync with web/vercel.json.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self' https://huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co",
].join("; ");

function securityHeaders(): Plugin {
  const setHeaders = (_req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    res.setHeader("Cross-Origin-Opener-Policy", COOP);
    res.setHeader("Cross-Origin-Embedder-Policy", COEP);
    res.setHeader("Content-Security-Policy", CSP);
    next();
  };
  return {
    name: "mechikon-security-headers",
    configureServer(server) {
      server.middlewares.use(setHeaders);
    },
    configurePreviewServer(server) {
      server.middlewares.use(setHeaders);
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), securityHeaders()],
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("../engine/src", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../dist-web", import.meta.url)),
    emptyOutDir: true,
  },
});
