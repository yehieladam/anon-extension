# CLAUDE.md — Project Constitution (anon-extension)

> Claude Code reads this file at the start of every session. It defines what we build, the stack,
> the rules, and how to develop. Follow it strictly. It overrides default behavior.

## What we are building

A **fully client-side** Hebrew PII anonymizer that runs entirely in the user's browser — detection,
anonymization, and restore all happen locally, **no server, no account, PII never leaves the device**.
Shipped first as a **public web app** (zero-install front door — best reach for a free tool, no Store
review gate, and it can run `crossOriginIsolated` for multi-threaded WASM), with a **Chrome extension
as a fast-follow** (always-on popup + select-text on any page; the web app links out to the Web Store
to install it). **Both reuse the same framework-free engine** — this ordering is a go-to-market choice,
not a technical one. The privacy-by-architecture story IS the product.

> **Decision (2026-08-02): web app first, extension fast-follow.** Supersedes the earlier
> "extension first" wording. Rationale in `docs/differentiation.md`. The MV3 spike stays loadable
> (S-01) as the proof it works under extension constraints; it is not retired by this change.
>
> **Decision (2026-08-03): delivery + owners + web-app stack.** The web interface is a **standalone
> Vite/React app** deployed as its **own Vercel project** on a **dedicated subdomain**
> (`anon.bai-solutions…`), cross-linked from the public BAI site (a Next.js/Vercel site), with a link
> to install the extension (CWS). Dedicated subdomain = clean `crossOriginIsolated` (multi-threaded
> WASM) and zero analytics/telemetry on that origin (a trust requirement — see `docs/trust.md`).
> The **NER model is self-hosted** (served same-origin/CDN with COOP/COEP-compatible CORP headers,
> aggressively cached) — brings P4-02 forward. Owners: **@yehieladam → web app (P2W)**,
> **@nadavnbs → extension (P2, P5)**. Embedding/isolation details in P2W-06.
>
> **Decision (2026-08-03): PDF + OCR are IN v1; single unified launch.** No early text-only launch —
> v1 ships everything together including PDF redaction and scanned-PDF OCR (see the File-parsing note
> above and the PDF track in `docs/tasks.md`). Gated by the PDF feasibility spike.
>
> **Decision (2026-08-03): the web app is open source (AGPL-compatible).** Required by `mupdf.js`
> (AGPL-3.0) and embraced as a trust asset ("read the code — nothing is uploaded"). No commercial
> MuPDF license. See P5-03 / `docs/trust.md` (TR-04).
>
> **Decision (2026-08-03): product identity + v1 scope.**
> - **Name: מחיקון / "Mechikon"** — subdomain `mechikon.bai-solutions…`, CWS listing "Mechikon".
> - **UI language: Hebrew only at launch** (audience is Israeli, RTL); i18n-ready so English can
>   follow without a rewrite — never hardcode strings.
> - **Design identity: professional / legal** (navy/slate, serious, trust-forward) — the audience is
>   risk-averse lawyers. This **supersedes** the earlier "organic" mockup (cream/terracotta/sage,
>   Suez One/Rubik) for this product.
> - **Recognizer scope v1: all 8 Israeli recognizers** (ID, phone, company, IBAN, case, land, policy,
>   insured) + Hebrew NER for names/orgs/places — the full Israeli-accuracy advantage.
> - **Placeholder alphabet: Hebrew gershayim U+05F4** (`[ת״ז_1]`), locked — LLM-round-trip-safe (P1-13).
> - **Model hosting: Cloudflare R2** (zero egress) with CORP/CORS/immutable-cache headers so
>   `crossOriginIsolated` holds; one-time cached per browser (P4-02).
> - **Restore key: default in-memory** (dies with the tab); download is opt-in; on download, passphrase
>   encryption is offered via a checkbox **checked by default** (KEY-01).

This is the client-side track. A separate server-side tool (Python/Streamlit/Presidio, in another
repo, deployed to the BAI portal) already exists and is NOT part of this repo.

**Real detection only.** Never simulate, hardcode, or fake a detection or a metric. Israeli ID / phone
/ company / IBAN etc. are deterministic (regex + checksum). Names/orgs/places are genuine neural NER
(dictabert-ner ONNX). If something can't be detected, say so — never fake it.

## The users (of the codebase)

Two developers — **Yehiel** (`@yehieladam`) and **Nadav** (`@nadavnbs`) — who may work on the same
tasks. Both rely on Claude to write most of the code. Explain what you do in plain terms; give exact
**Windows** commands when the user must run something.

## Tech stack (use exactly these)

- **Language:** TypeScript, **strict** (no `any` without a `// reason:` comment). Node 20 LTS. npm.
- **Engine (`engine/`):** pure TypeScript, **framework-free, no DOM, no extension APIs** — so it is
  reused unchanged by the extension and a future web app. Only runtime dep: `@huggingface/transformers`
  **pinned to 4.2.0** (v3 lacks `aggregation_strategy`).
- **NER model:** `onnx-community/dictabert-ner-ONNX`, dtype **q8** (~185 MB). Self-hosted on our
  VPS/CDN in production; the spike loads from the HF CDN. WASM backend by default (beats WebGPU on
  integrated GPUs — proven in Phase 0), WebGPU opportunistic.
- **Extension UI (`extension/`):** React 18 + **Vite** + Tailwind, built for **Manifest V3** via
  `@crxjs/vite-plugin`. The UI is a thin shell that imports `engine/`.
- **Web app (`web/`):** React 18 + **Vite** + Tailwind (+ **shadcn/ui**), on its own Vercel project
  (subdomain `mechikon.bai-solutions…`). Thin shell over `engine/`.
- **Off-main-thread (required):** the engine runs in a **Web Worker** (via **Comlink**) — 185 MB NER +
  mupdf/tesseract WASM must never block the UI thread. Heavy WASM (mupdf, tesseract) is **lazy-loaded**
  only when a PDF/scan is actually used. Model + WASM cached by a **Service Worker** (also powers the
  offline-proof trust demo — TR).
- **i18n:** **i18next** from day 1 — Hebrew-only at launch but **no hardcoded strings**, so English can
  follow. Hebrew webfont is **self-hosted** (no Google Fonts CDN — that would break CSP/zero-network).
- **File parsing:** `mammoth` (docx), `xlsx`/SheetJS (xlsx). **PDF is IN v1** (decision 2026-08-03,
  supersedes the earlier "PDF OUT of MVP") — via **`mupdf.js`** (the WASM build of MuPDF, the same
  engine behind the server's PyMuPDF; `page.applyRedactions()` does true content removal in the
  browser, zero server) and **`tesseract.js`** for scanned-PDF OCR (Hebrew accuracy is the open risk,
  not feasibility). **PDF-01 spike: GO for the text path** — `mupdf` 1.28.0 truly removes Hebrew PII
  client-side. Two proven rules the impl MUST follow: save with **`{garbage:"deduplicate", compress:true,
  sanitize:true}`** (a plain/`compress`-only save STILL leaks the orphaned content stream — `%%EOF` count
  is NOT a sufficient check; the **raw-byte scan is the real gate**); and locate PII by **glyph quads**,
  not by searching extracted text (MuPDF returns Hebrew in reversed visual order). Scanned/image-pixel
  redaction is UNVERIFIED (gates PDF-05). Fallback if a path is NO-GO: text/DOCX output — never a server.
- **Tests:** **Vitest** (unit, engine, headless). **Browser tests: Playwright** — the WASM redaction/OCR
  and the 3-layer PDF acceptance test can't be verified in node-only Vitest; they run in a real browser.
  **Lint/format:** ESLint (typescript-eslint) + Prettier. **CI:** GitHub Actions.

Do not add a dependency without a reason. Prefer the platform + these libs over new packages.

## Hard rules

1. **Real detection only** (see above). Determinism for numbers: regex + checksum, never the NER model.
2. **Everything runs client-side.** No server calls, no account, no telemetry, no analytics, no remote
   logging. The only network fetch allowed is downloading the model files (once, cached). Anything that
   phones home breaks the product's core promise — do not add it. **Corollary — no remote error
   monitoring either** (no Sentry). We accept being blind to remote crashes; instead surface errors
   locally with an opt-in "copy error report" the user chooses to share. Never auto-send.
3. **No PII, no secrets in the repo.** Test data is synthetic (fictional names). `.env` is gitignored.
   Never commit the model files (`*.onnx`) — they are fetched at runtime.
4. **The engine stays framework-free.** No React/DOM/extension imports in `engine/`. If you need those,
   you are in the wrong layer (`extension/`).
5. **MV3 = no remote code.** transformers.js AND the onnxruntime-web runtime (`.mjs` + `.wasm`) are
   vendored locally and `env.backends.onnx.wasm.wasmPaths` is overridden; `numThreads = 1` (extension
   pages aren't crossOriginIsolated). See `docs/chrome-extension-plan.md` §3 — this bit us once.
6. **Plan before code** for a new task: a short plan, then wait for approval.
7. **Windows-friendly.** Exact `npm ...` commands; forward-slash paths.
8. **Keep the MV3 spike (`extension/` as first built) loadable** until the React/Vite build replaces it
   in P2 — don't break the working proof.

## Workflow (orderly + safe — see CONTRIBUTING.md for detail)

- `main` is protected: **no direct pushes**. Every change lands via **PR → CI green → 1 review → merge**.
- **One branch per task**, named `feat/…`, `fix/…`, `chore/…` (NOT per person) so overlapping work is
  visible. **Claim a task** in `docs/tasks.md` / GitHub Issues before starting so two people don't
  duplicate it. Small PRs. Rebase on `main` often.
- Before opening a PR: `npm run typecheck && npm run lint && npm test` must pass locally (CI enforces it).
- Conventional commits: `feat: …`, `fix: …`, `chore: …`, `docs: …`, `test: …`, `refactor: …`. English.
  No emojis in code or commits.

## Code quality

- TypeScript strict; small focused files (200–400 lines typical, 800 max); functions < 50 lines;
  no deep nesting (early returns); explicit error handling; immutable patterns (return new, don't mutate).
- Validate input at boundaries. Handle errors visibly in the UI; never swallow silently.
- All user-facing text via a translation layer (Hebrew RTL + English LTR). Test both directions on layout.
- No `console.log` left in shipped code; no dead code.

## Definition of Done (per task)

- [ ] Code + tests (unit for engine logic; recall check for NER changes against `browser-poc/ner_testset.json`).
- [ ] `typecheck`, `lint`, `test` green locally and in CI.
- [ ] No PII/secrets; no new network calls; engine stays framework-free.
- [ ] Docs updated if behavior/stack changed. PR description filled (template).

## Key references (read before relevant work)

- `docs/chrome-extension-plan.md` — the roadmap, phases, and every MV3 constraint (READ before extension work).
- `docs/STACK.md` — exact stack + versions + rationale.
- `browser-poc/PHASE0_FINDINGS.md` — proven model facts (q8 parity, WASM>WebGPU, the tokenizer `\"`
  `/u` shim, null-offset/`##` handling). The engine port MUST carry these fixes.
- `docs/tasks.md` — the task board (phase → task → owner → Definition of Done).

## Commands (Windows)

```
npm install                 # first-time setup
npm run dev                 # Vite dev (extension popup with HMR)
npm run build               # production build → the loadable/zippable extension
npm run typecheck           # tsc --noEmit
npm run lint                # eslint
npm test                    # vitest
```

Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → the build output
(or `extension/` for the current pre-build spike). See `extension/README.md`.
