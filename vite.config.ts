import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/manifest.config";

// Builds the React MV3 popup into dist/.
// The hand-built plain-JS spike in extension/ is untouched by this build and stays
// loadable until P2-01 is verified in Chrome (see docs/tasks.md).

// onnxruntime-web's runtime, which transformers.js loads by URL at inference time.
// Left on its jsdelivr default the .mjs is remote CODE and MV3 CSP blocks it — see
// CLAUDE.md hard rule 5 and docs/chrome-extension-plan.md section 3.
const ORT_RUNTIME_FILES = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
];

/**
 * Copy the ORT runtime out of node_modules into public/ort/, so Vite serves it in dev and
 * emits it to dist/ort/ on build. Copying beats committing the 23.5 MB .wasm: the shipped
 * runtime stays pinned to whatever the lockfile resolved, so it cannot drift from the
 * version transformers.js expects.
 */
function copyOrtRuntime(): Plugin {
  return {
    name: "anon-copy-ort-runtime",
    buildStart() {
      const require = createRequire(import.meta.url);
      // onnxruntime-web does not export ./package.json, so resolve its entry and walk up.
      const ortDist = path.dirname(require.resolve("onnxruntime-web"));
      const target = fileURLToPath(new URL("./public/ort", import.meta.url));
      mkdirSync(target, { recursive: true });

      for (const file of ORT_RUNTIME_FILES) {
        const from = path.join(ortDist, file);
        const to = path.join(target, file);
        const source = statSync(from);
        // Skip the 23.5 MB copy when it is already current, so dev restarts stay fast.
        if (existingIsCurrent(to, source.size, source.mtimeMs)) continue;
        copyFileSync(from, to);
      }
    },

    // Rollup follows a `new URL('…asyncify.wasm', import.meta.url)` reference inside the
    // ORT loader that transformers.js bundles in, and emits a second, hashed copy of the
    // same 23.5 MB binary into assets/ — doubling the packaged extension for nothing.
    // configureOrtRuntime() overrides wasmPaths to dist/ort/ before any pipeline is
    // created, so that reference is never followed at runtime. Drop it.
    // Verified end-to-end by the P2-01 parity run, not assumed.
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === "asset" && /ort-wasm-.*\.wasm$/.test(fileName)) {
          delete bundle[fileName];
        }
      }
    },
  };
}

function existingIsCurrent(file: string, size: number, mtimeMs: number): boolean {
  try {
    const existing = statSync(file);
    return existing.size === size && existing.mtimeMs >= mtimeMs;
  } catch {
    return false;
  }
}

export default defineConfig({
  plugins: [copyOrtRuntime(), react(), crx({ manifest })],
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("./engine/src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
