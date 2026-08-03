// ESLint 9 flat config (the single source of lint truth — there is intentionally NO
// .eslintrc / .eslintignore; ESLint 9 does not read .eslintignore, ignores live below).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      // The hand-built plain-JS MV3 spike is frozen as the working proof (CLAUDE.md
      // hard rule 8) — never lint or "fix" it. Includes extension/vendor/**.
      "extension/**",
      // Phase-0 reference artifacts, not product code.
      "browser-poc/**",
      // Third-party onnxruntime-web runtime, copied out of node_modules at build time by
      // the copyOrtRuntime plugin in vite.config.ts — vendor code, never ours to lint.
      "public/ort/**",
      "dist/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // The engine is framework-free (CLAUDE.md hard rule 4) — block the obvious violations.
    files: ["engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*", "react-dom/*"],
              message: "engine/ is framework-free — no React here (CLAUDE.md hard rule 4).",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "document", message: "engine/ is framework-free — no DOM here." },
        { name: "window", message: "engine/ is framework-free — no DOM here." },
        { name: "chrome", message: "engine/ is framework-free — no extension APIs here." },
      ],
    },
  },
  {
    rules: {
      // CLAUDE.md: no `any` without a `// reason:` comment — the rule stays "error";
      // a justified exception uses eslint-disable-next-line WITH the reason comment.
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "error",
    },
  },
);
