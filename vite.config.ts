import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/manifest.config";

// Builds the NEW React MV3 popup (P2 target) into dist/.
// The hand-built plain-JS spike in extension/ is untouched by this build and stays
// loadable until P2-01 verifies this build as its replacement (see docs/tasks.md).
export default defineConfig({
  plugins: [react(), crx({ manifest })],
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
