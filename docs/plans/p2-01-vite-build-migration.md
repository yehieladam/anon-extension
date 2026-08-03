# P2-01 plan — migrate the spike into the Vite/crxjs build

> Status: **DRAFT, awaiting approval** (CLAUDE.md hard rule 6). Branch: `feat/p2-01-vite-build`.
> Unblocked by S-01 (**GO**, 2026-08-02 — see `extension/README.md`).

## Goal

Make `npm run build` produce a `dist/` that loads unpacked and runs NER **at parity with the
frozen `extension/` spike**. Today it cannot: the React build never imports transformers.js at
all (the 145 KB bundle is React + the Luhn validator). This task is the gate on every other P2
task, so it is deliberately scoped to *the build*, not the product UI.

**DoD (from `docs/tasks.md`):** `npm run build` output loads unpacked; NER runs; spike parity
confirmed; then `extension/` may be archived.

## The five decisions this plan makes

**1. Bundle transformers.js from npm — do not vendor `transformers.min.js` a second time.**
The spike vendors the dist file because it has no bundler. We have one, and
`@huggingface/transformers@4.2.0` is already a real dependency; its `exports.default` resolves
to `dist/transformers.web.js`, which is what a browser build wants. Vendoring again would mean
two copies to keep in sync.

**2. Copy the ORT runtime from `node_modules` at build time — do not hand-copy it into the repo.**
`node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.{mjs,wasm}` is already the
exact pinned version (`1.26.0-dev.20260416-b7804b056c`) and byte-for-byte the size of the
spike's vendored copies. A ~15-line inline Vite plugin in `vite.config.ts` copies both into
`dist/ort/` on `buildStart`, so dev and build both get them and the version can never drift from
the lockfile. **No new dependency** (rules out `vite-plugin-static-copy`), and the 23.5 MB
`.wasm` stays out of git.

**3. The `wasmPaths` override lives in `src/`, never in `engine/`.**
It needs `chrome.runtime.getURL('ort/…')` to build an absolute extension URL — the popup HTML
sits at `dist/src/popup/index.html`, so relative paths are fragile. `chrome.*` is banned in the
engine (hard rule 4), which makes this the shell's job by construction. Also pins
`numThreads = 1` for the same reason the spike does.

**4. The RegExp shim becomes `engine/src/tokenizerShim.ts`, exported as an explicit
`installTokenizerShim()` — not a side-effecting import, not a classic script.**
It is pure JS (no DOM), so it is legal in the engine, and the future web app needs it just as
much as the extension does. Making it a function the shell calls keeps it greppable instead of
magic. It only has to run before `pipeline()` builds the tokenizer, not before module
evaluation, so the spike's classic-script-ordering trick is unnecessary here.

**5. P2-01 does NOT wait for P1-11.**
The DoD is *spike parity*, and the spike does raw `pipeline(...)` with null offsets and no
offset reconstruction. Blocking on `ner.ts` would serialise the two riskiest tasks. So this
task ports `popup.js`'s pipeline call into a small `src/popup/nerParity.ts` (~60 lines) whose
job is to reproduce the spike's debug output exactly. P1-11 later replaces it with the real
engine wrapper and it is deleted. That throwaway is intentional and cheap.

## Changes, file by file

| File | Change |
|---|---|
| `vite.config.ts` | inline `copyOrtRuntime()` plugin → `dist/ort/`; verify `publicDir` interaction |
| `src/manifest.config.ts` | add `icons` (currently missing from `dist/manifest.json`); CSP already correct — no change needed |
| `engine/src/tokenizerShim.ts` | **new** — the Phase-0 `/u` shim as `installTokenizerShim()` |
| `engine/src/index.ts` | export it |
| `src/popup/ortSetup.ts` | **new** — `wasmPaths` via `chrome.runtime.getURL`, `numThreads = 1`, fail loudly if `env.backends.onnx.wasm` is absent (copy the spike's loud-failure behaviour) |
| `src/popup/nerParity.ts` | **new, temporary** — pipeline creation + WebGPU→WASM fallback + `runNer()`, ported from `extension/popup.js` |
| `src/popup/App.tsx` | replace the Luhn scaffold with the spike's textarea + button + results table |
| `extension/` | **untouched** (hard rule 8) — archived only after this build is verified |

## Verification — automated, against a recorded baseline

S-01 left a reusable harness (`scratchpad/s01.mjs`) and a machine-readable baseline
(`s01-warm.json`: 19 spans with tags and scores). Parity checking is therefore mechanical:

1. `npm run build`, load `dist/` unpacked in Chrome for Testing via `--load-extension`.
2. Run the **same 5-line sample**, diff the resulting spans against the spike's 19.
   Pass = identical tags, surfaces, and scores to 3 decimals.
3. Confirm zero console errors, and zero external network requests on a warm reopen.
4. Confirm `typecheck`, `lint`, `test` stay green.

Expect the benign `Failed to cache ort-wasm-…wasm: Request scheme 'chrome-extension' is
unsupported` warning to reappear — S-01 established it is harmless. Decide during the task
whether to suppress it; do not treat it as a failure.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Vite/rollup mis-bundles `transformers.web.js` (dynamic ORT import, top-level await) | **Medium — the main unknown** | `optimizeDeps.exclude` / mark ORT external and rely on the copied runtime; fall back to vendoring the dist file as the spike does |
| crxjs rewrites or hashes the `dist/ort/` paths, breaking `wasmPaths` | Medium | assert the exact output paths in the build; use `chrome.runtime.getURL`, never a bundler-rewritten URL |
| Shim runs too late and the tokenizer regex throws | Low | S-01 proved the failure is loud and immediate; call it at module top of `main.tsx` |
| WASM path still unproven | Low, but real | S-01 only exercised WebGPU (Apple Silicon). Force `device: 'wasm'` once during verification so both paths are covered before `extension/` is archived |

## Explicitly out of scope

Real UI (P2-02), design tokens (P2-03), offsets/`##`/tag mapping (P1-11), any recognizer,
archiving `extension/` (a follow-up commit once this is verified in Chrome).

## Estimate

Roughly a day. The long pole is risk #1 — if transformers.js bundles cleanly it is a few hours;
if it fights the bundler, budget the fallback.
