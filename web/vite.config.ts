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

function crossOriginIsolation(): Plugin {
  const setHeaders = (_req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    res.setHeader("Cross-Origin-Opener-Policy", COOP);
    res.setHeader("Cross-Origin-Embedder-Policy", COEP);
    next();
  };
  return {
    name: "mechikon-cross-origin-isolation",
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
  plugins: [react(), crossOriginIsolation()],
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
