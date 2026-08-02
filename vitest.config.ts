import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("./engine/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["engine/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    // CI must not fail while parts of the codebase have no tests yet.
    passWithNoTests: true,
  },
});
