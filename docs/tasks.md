# Task board — anon-extension

> **How to use:** before starting a task, set `Owner:` to your handle and push/commit that change
> (claim-first rule — see `CONTRIBUTING.md`). One branch per task: `feat/<id>-short-name`.
> Phases map to `docs/chrome-extension-plan.md` §6. Check the box only when the task's DoD is met
> AND the global Definition of Done in `CLAUDE.md` passes.

> **Decision update (2026-08-02): restore IS in the MVP.** This supersedes the "anonymize-only
> MVP / restore deferred" wording in `docs/chrome-extension-plan.md` §6-§7. `restore.ts` is task
> P1-15 below; the key format (P1-14) was already restore-compatible by design.

## Spike — MV3 mechanics (built, awaiting manual verification)

- [ ] **S-01** Load the built spike in real Chrome and record go/no-go
  Owner: unassigned
  Scope: `chrome://extensions` → load unpacked `extension/` → run sample text; confirm spans render, WASM badge, model cache-hit on reopen (steps in `extension/README.md`).
  DoD: result (screenshots + verdict) noted in `extension/README.md`; GO unlocks P1 NER port confidence.

## P1 — engine module (`engine/src/`, framework-free TS)

Fine-grained on purpose: recognizers are independent, so both devs can pick in parallel.
Every recognizer ports the matching server file (`pii-anonymizer-spike/src/recognizers/*.py`),
keeps detection deterministic (regex + checksum — never NER for numbers), and ships a Vitest
unit test with the same valid/invalid cases the server checks use.

- [x] **P1-01** Engine scaffold: `types.ts` (EntityType, Span, Recognizer, AnonymizeResult, KeyRow) + `index.ts` barrel
  Owner: yehieladam (landed in `chore/foundation`)
  DoD: compiles strict; barrel exports the public surface; no framework imports.
- [x] **P1-02** `recognizers/israeliId.ts` — ת"ז, Luhn checksum
  Owner: yehieladam (landed in `chore/foundation`)
  DoD: same 5 valid / 5 invalid IDs as server `check_task1.py` pass in Vitest; 000000000 rejected.
- [x] **P1-03** `recognizers/israeliPhone.ts` — IL_PHONE (mobile + landline formats)
  Owner: yehieladam
  DoD: numbering-plan regex (05x/07x mobile, 02/03/04/08/09 landline, +972 trunk) + validator; 37 unit tests (052-/03- samples, +972, separators, negatives, 9-digit-ID guard, no-bite-into-long-run). Server `israeli_phone.py` not vendored here — faithful re-impl, reconcile if server samples diverge.
- [x] **P1-04** `recognizers/israeliCompany.ts` — IL_COMPANY (ח״פ, checksum like ID)
  Owner: yehieladam
  DoD: 9 digits + leading 5 + Luhn check; 24 tests (valid/invalid checksum, non-5 ID rejected, length, offsets). Overlap with ISRAELI_ID (both 9-digit Luhn) resolved by P1-12. Server file not vendored — faithful re-impl.
- [x] **P1-05** `recognizers/israeliIban.ts` — IL_IBAN (IL + mod-97)
  Owner: yehieladam
  DoD: real ISO-13616 mod-97 over IL + 21 digits; 9 tests (canonical valid compact/spaced/lowercase, broken checksum, wrong length/prefix, offsets). Server file not vendored — faithful re-impl.
- [x] **P1-06** `recognizers/israeliCase.ts` — IL_CASE (מספר תיק)
  Owner: yehieladam
  DoD: conservative (precision-first) — net-hamishpat dash format (5–7 digit first group, excludes ISO dates) + numbers introduced by תיק; score 0.9 (no checksum). 9 tests. **RECONCILE:** case-type-prefixed forms (ת״א/בג״ץ …) intentionally deferred to the server file to avoid over-matching Hebrew abbreviations.
- [x] **P1-07** `recognizers/israeliLand.ts` — IL_LAND (גוש/חלקה)
  Owner: yehieladam
  DoD: keyword-anchored (both גוש and חלקה + numbers), optional /sub-plot; single span; 6 tests incl. keyword-only and lone-חלקה negatives. Server file not vendored — faithful re-impl.
- [x] **P1-08** `recognizers/israeliPolicy.ts` — IL_POLICY (מספר פוליסה)
  Owner: yehieladam
  DoD: context-anchored on פוליסה (no national format exists); flags the number token only; score 0.9; 4 tests incl. hyphenated tokens + keyword-only negative. Server file not vendored — faithful re-impl.
- [x] **P1-09** `recognizers/israeliInsured.ts` — IL_INSURED (מספר מבוטח)
  Owner: yehieladam
  DoD: context-anchored on מבוטח; flags the number only; ignores the bare word; score 0.9; 4 tests. Server file not vendored — faithful re-impl.
- [x] **P1-10** `recognizers/email.ts` — EMAIL_ADDRESS (replaces Presidio's built-in)
  Owner: yehieladam
  DoD: RFC-sane structural regex (local@domain.tld, TLD ≥2); 8 tests incl. `.co.il`, trailing-period exclusion, multiple, and no false hits on Hebrew prose / bare `@` / TLD-less host.
- [x] **P1-11** `ner.ts` — transformers.js token-classification wrapper (dictabert-ner-ONNX q8)
  Owner: yehieladam
  Scope: WASM default; the Phase-0 tokenizer `\"`/`\'` `/u` RegExp shim (`installTokenizerRegexShim`); reconstruct null char offsets + strip/re-join `##` wordpieces (hyphenated names) in `reconstructNerSpans`; tags mapped PER→PERSON, ORG→ORGANIZATION, GPE/LOC/FAC→LOCATION. Model imported dynamically so pure helpers stay CI-testable.
  DoD: **8 unit tests for offset/`##` reconstruction against RECORDED model outputs** (`browser-poc/browser_result.json`) — clean spans, the hyphenated `##` artifact rebuilt to the full name, unmapped-tag/no-match skips, repeated-surface cursor. Full suite 160 green. **Live recall harness (≥88.89% vs `ner_testset.json`) is a MANUAL run** — the 185 MB model is never downloaded in CI; Phase-0 already proved q8 parity and the `##` fix closes the documented gaps. Re-run manually before launch.
- [x] **P1-12** `resolve.ts` — overlap resolution (PRIORITY map, deterministic > NER)
  Owner: yehieladam
  DoD: greedy keep-strongest by PRIORITY → score → length → start → type (total order = deterministic regardless of source concat order); 7 tests (ID-inside-PERSON, adjacent survive, score/length tiebreaks, reading-order output, equal-strength collapse, no input mutation).
- [x] **P1-13** `anonymize.ts` — typed Hebrew placeholders (U+05F4), consistent per surface value
  Owner: yehieladam
  Scope: gershayim U+05F4 labels (`[ת״ז_1]`, `[ח״פ_2]`); per-type numbering by first appearance in reading order; same value → same placeholder. **Design note:** consistency is keyed on the EXACT surface value (not a normalized form) so `restore(anonymize(text))` is byte-exact — collapsing different surfaces into one placeholder would make restore lossy. Tolerance for LLM-mangled placeholder TOKENS lives in P1-15, not here.
  DoD: 6 tests (placeholders + key rows, repeat→same placeholder, per-type reading-order numbering, U+05F4 not ASCII quote, empty spans, independent per-type counters). Suite green.
- [x] **P1-14** `key.ts` — canonical `key.v1` JSON + CSV export (restore-compatible)
  Owner: yehieladam
  Scope: canonical `key.v1` JSON `{version, docId?, createdAt?, rows:[{placeholder,original,type}]}` (docId/createdAt set by the caller — engine stays pure, no Date/hash here); CSV = RFC-4180 (BOM added by the download layer). 6 tests: CSV + JSON round-trips lossless incl. Hebrew with commas/quotes/newlines; header-only for empty; malformed key rejected.
- [x] **P1-15** `restore.ts` — tolerant placeholders → originals (**MVP**)
  Owner: yehieladam
  Scope: tolerant matcher — NFC, quote-variant class (incl. gershayim ↔ ASCII/curly quotes), optional whitespace, and strips bidi controls (U+200E/F, U+202A–202E, U+2066–2069). Non-placeholder brackets ignored; inserted originals not re-scanned (no double-restore). Unmatched tokens reported, never silent.
  DoD: 6 tests incl. smart-quoted/curly-quote tokens, injected spaces+bidi, unmatched report, non-token brackets — **and a full end-to-end round-trip through the real pipeline (recognizers → resolve → anonymize → restore) === original**. Full suite 152 green.
- [ ] **KEY-01** Restore-key UX + optional passphrase encryption (decisions 2026-08-03)
  Owner: unassigned
  Scope (Fable 5): **default = in-memory only** (the key map dies when the tab closes — the differentiation claim); **download is opt-in** (explicit user action). On download, offer passphrase **encryption via a checkbox that is CHECKED by default** (optional, recommended). Crypto: Argon2id via `hash-wasm` (MIT, tiny) → AES-256-GCM via native WebCrypto (zero added bytes); envelope `{v, kdf:{argon2id params,salt}, nonce, ciphertext}`; PBKDF2 ≥600k iters as zero-dep fallback. `crypto.subtle` works in workers/Node20 → stays framework-free. Marketing: "your restore vault is a file only you hold — encrypted, and we never saw it."
  DoD: default in-memory (no auto-download); opt-in download works; encryption checkbox default-on; encrypt/decrypt round-trip with passphrase; wrong passphrase fails cleanly; engine unit-tested headless.

## P0I — foundational infra & tooling (before the P2W UI — stack-gap review 2026-08-03)

Architecture/tooling gaps found in the pre-build review. **Several are prerequisites for P2W** — don't
build the UI on the main thread and retrofit later.

- [x] **P0I-01** Engine in a **Web Worker** via **Comlink** (HARD prerequisite for P2W)
  Owner: yehieladam
  Scope: `web/src/worker/engine.worker.ts` (Comlink.expose) + `engineClient.ts` (lazy single module worker, Comlink.wrap). Engine helper `engine/src/pipeline.ts` (`anonymizeDeterministic`/`detectDeterministic`/`anonymizeFull`) orchestrates recognizers→resolve→anonymize so the worker stays thin and it's reusable by the extension. **The worker imports specific engine modules, NOT the barrel** — this keeps ner.ts (transformers.js + 23 MB onnxruntime wasm) out of the graph, so the deterministic path is instant and the model can lazy-load later (P0I-02). Verified: `build:web` emits a separate 9.6 kB worker chunk and NO ort-wasm.
  DoD: paste→anonymize→restore runs off the UI thread via a typed Comlink surface ✅; app never calls the engine on the main thread ✅. (Live in-browser drive: P0I-06 Playwright.)
- [ ] **P0I-02** **Lazy-load** heavy WASM (mupdf, tesseract) only when PDF/scan is used
  Owner: unassigned
  Scope: someone pasting text must NOT pay for mupdf/tesseract. Dynamic-import the PDF/OCR modules on first use; NER model loads for the core flow.
  DoD: text-only session never fetches mupdf/tesseract; PDF/scan triggers their load with progress.
- [ ] **P0I-03** **Service Worker**: cache model + WASM (one-time per browser) + power the offline proof
  Owner: unassigned
  Scope: Cache API/SW so the 185 MB model + WASM are one-time; also enables the "works offline" trust demo (TR). Coordinates with R2 caching (P4-02).
  DoD: second visit is fully cache-served (verify offline); model integrity checked (see P0I-04).
- [ ] **P0I-04** **Model integrity check** (hash-verify the R2 download)
  Owner: unassigned
  Scope: verify the downloaded model file against a known SHA-256 so a compromised CDN can't swap it. Trust + supply-chain.
  DoD: mismatched hash refuses to run with a clear error; expected hash pinned in the build.
- [ ] **P0I-05** **i18next** set up day 1 (Hebrew-only launch, no hardcoded strings) + **self-hosted Hebrew font**
  Owner: yehieladam
  Scope: all UI text via keys (he now, en later); professional Hebrew webfont self-hosted (no Google Fonts CDN — breaks CSP/zero-network). **i18next WIRED in P2W-01** (`web/src/i18n.ts` + `web/src/locales/he.ts`, keys from `docs/ux-copy.md`); shell strings all via `t()`. REMAINING: self-host the Hebrew webfont (Rubik is referenced in CSS but not yet vendored) + fill remaining keys as the flow grows.
  DoD: zero hardcoded UI strings ✅ (shell); font served locally (pending); RTL correct ✅.
- [ ] **P0I-06** **Playwright** browser-test harness (enforces the PDF/OCR acceptance tests)
  Owner: unassigned
  Scope: node-only Vitest can't verify WASM redaction/OCR; Playwright runs the real-browser 3-layer PDF acceptance test + core flows in CI.
  DoD: Playwright wired into CI; a PDF redaction acceptance test runs in-browser and fails on any PII leak.
- [ ] **P0I-07** **Local error strategy** (no remote monitoring — hard rule)
  Owner: unassigned
  Scope: no Sentry/telemetry; catch errors, show a friendly message + an opt-in "copy error report" the user chooses to share. Never auto-send.
  DoD: unhandled errors surfaced locally; copy-report works; nothing leaves the device automatically.
- [ ] **P0I-08** **shadcn/ui** baseline + accessibility (WCAG, 44px targets, RTL)
  Owner: unassigned
  DoD: shadcn/ui installed; interactive elements ≥44px; keyboard + screen-reader sane; RTL checked.

## P2W — web app (public front door, ships first — see CLAUDE.md decision 2026-08-02)

**Owner: @yehieladam** (sole developer — as of 2026-08-04 Yehiel owns every track).

The **web app is the first public surface** (zero install, best reach, no Store review, and it can run
`crossOriginIsolated` → multi-threaded WASM → faster NER). Reuses `@engine/*` unchanged. The popup
below (P2) becomes the **fast-follow** extension. Both share the engine — this is go-to-market ordering.

**Delivery decision (2026-08-03):** product name **מחיקון / "Mechikon"**, served on a **dedicated
subdomain `mechikon.bai-solutions…`** (own Vercel project), **cross-linked from the BAI site** (plain
link, no proxy) + a **link to install the extension**. Note: a subdomain is **free** (just DNS) — cost
was never the issue. Chosen over a path (`/mechikon` via Next rewrite) because a separate origin gives
`crossOriginIsolated` (COOP/COEP → multi-threaded WASM) AND zero analytics **automatically** (BAI's
global GA/pixel physically can't load on another origin) — a path would require manually scoping
headers and excluding tracking. Trade-off accepted: slightly less "under the main domain" for SEO/brand
vs guaranteed isolation. If isolation somehow isn't achievable, NER falls back to `numThreads=1` — not
a blocker. The Mechikon build stays in THIS repo (open-source/AGPL), never merged into the BAI site code.

- [x] **P2W-01** React + Vite web app shell (`web/`), imports `@engine/*` — SHELL DONE
  Owner: yehieladam
  Scope: separate Vite build (`web/vite.config.ts`, `npm run build:web` → `dist-web`), own `web/vercel.json` + a dev/preview COOP/COEP plugin so the page is `crossOriginIsolated`; professional/legal RTL shell (hero, 4-step strip, input placeholder, trust strip, footer) with all strings via i18n; `@engine` alias reused. Build/typecheck/lint green.
  DoD (shell): ✅ `build:web` produces `dist-web`; ✅ COOP/COEP configured (dev + vercel.json). REMAINING (moves to P2W-02 + P0I-01): wire the actual detect→anonymize→restore flow through the Worker, then verify NER runs in-browser with no PII network calls.
- [~] **P2W-02** Paste flow end-to-end: detect → highlight by type → anonymized copy → download key
  Owner: yehieladam
  Scope: PARTIAL — the working loop is wired in `web/src/App.tsx`: paste → "השחרה" → (worker) `anonymizeDeterministic` → anonymized text on screen (U+05F4 placeholders) + found-count + copy; plus a restore panel (also covers **P2W-03**: paste anonymized/AI text → originals back, unmatched surfaced). Real deterministic detections only; RTL; all strings via i18n. REMAINING: per-type highlight coloring + count chips, keep-word rescue (P2-04 parity), key CSV/JSON download (P1-14/KEY-01), and the NER name pass (needs the model-load step).
  DoD: real detections only ✅; RTL ✅; per-type count chips — pending; download key — pending.
- [ ] **P2W-03** "Anonymize before the AI" round-trip UI: paste an AI reply containing placeholders → restore originals (uses P1-15)
  Owner: unassigned
  Scope: the killer use case both competitors monetize (see `docs/differentiation.md`) — strip PII → send sanitized text to ChatGPT/Claude → paste the answer back → real values restored. All in-browser; the token→value map lives only in the tab.
  DoD: full round-trip works on a real doc + its key; restored answer matches originals; missing-key handled explicitly.
- [ ] **P2W-04** "Zero network" proof surface (turn the privacy claim into something verifiable) — **BLOCKING GATE before any deploy**
  Owner: yehieladam
  Scope: small badge/panel stating "0 network requests (except the one-time model download)". **⚠️ Code review 2026-08-04:** the shell currently renders a STATIC "0 בקשות רשת" badge (`web/src/App.tsx`, commented as a placeholder). `docs/trust.md`: "a trust surface that lies once is dead forever." The badge MUST reflect real observed network state before the site is ever deployed — a static badge that could show "0" while a request happened is disqualifying for this audience.
  DoD: badge reflects real observed state; no false claim; visible in the UI. **Nothing ships to a public URL until this is real.**
- [ ] **P2W-05** Design system: **professional/legal** identity (navy/slate, trust-forward) on the web app
  Owner: unassigned
  Scope: decision 2026-08-03 — audience is risk-averse lawyers; **supersedes the earlier organic mockup** (cream/terracotta/sage, Suez One/Rubik). Semantic tokens, not raw colors. Hebrew-only UI, RTL.
  DoD: professional/legal tokens defined; RTL correct; trust surface (TR) prominent, not in the footer.
- [ ] **P2W-06** Deploy Mechikon on the `mechikon.bai-solutions…` subdomain + cross-link from BAI + install-extension link
  Owner: unassigned
  Scope: own Vercel project on the subdomain (isolation decided — see header); DNS CNAME from the BAI domain; prominent link from the main BAI site to the tool; wire the CWS install link (P5-05). Verify `crossOriginIsolated` is true and zero analytics on the origin.
  DoD: `mechikon.bai-solutions…` live; `crossOriginIsolated === true`; no analytics/PII network calls; linked from BAI; install-extension link present.

## P2 — popup UX (Chrome extension, fast-follow after P2W; React shell in `src/`, imports `@engine/*`)

**Owner: @yehieladam** (sole developer). The extension is a fast-follow after the web app.

- [ ] **P2-01** Migrate the spike into the Vite/crxjs build (retire `extension/` as the loadable)
  Owner: unassigned
  Scope: vendor onnxruntime `.mjs`+`.wasm` into the built output, `wasmPaths` override, `numThreads=1`, CSP `'wasm-unsafe-eval'` + `connect-src` (plan §3) — the spike stays untouched until this build is verified load-unpacked in Chrome.
  DoD: `npm run build` output loads unpacked; NER runs; spike parity confirmed; then `extension/` may be archived.
- [ ] **P2-02** Paste flow end-to-end: detect → highlight by type → anonymized copy → download key
  Owner: unassigned
  DoD: real detections only; RTL correct; per-type counts shown.
- [ ] **P2-03** Design system: **professional/legal** identity on the popup (shared tokens with P2W-05)
  Owner: unassigned
  Scope: same professional/legal system as the web app (supersedes the organic mockup); Hebrew-only, RTL.
  DoD: matches the P2W-05 token set; RTL correct.
- [ ] **P2-04** Keep-word rescue + per-type toggles (mirror the Streamlit tool)
  Owner: unassigned
  DoD: manual keeps thread through preview, key CSV, and outputs.
- [ ] **P2-05** Restore / "anonymize before the AI" round-trip UI in the popup (MVP, uses P1-15)
  Owner: unassigned
  Scope: same killer flow as P2W-03 but in the extension popup — upload key + anonymized text (or an AI reply with placeholders) → originals restored locally.
  DoD: round-trip works in the popup on a real anonymized doc + its key.

## P3 — files (no PDF — see separate track)

- [ ] **P3-01** DOCX in/out (mammoth read, `docx` write with placeholders)
  Owner: unassigned
  DoD: synthetic Hebrew docx anonymizes and downloads; text intact apart from placeholders.
- [ ] **P3-02** XLSX in/out (SheetJS read + write)
  Owner: unassigned
  DoD: integer-looking cells never gain a spurious `.0` (would break ID/phone detection — server lesson); round-trip test.

## P4 — warm model + self-host

- [ ] **P4-01** Offscreen document keeps the pipeline loaded across popup opens
  Owner: unassigned
  DoD: reopen-to-ready < 1 s warm; offscreen justification enum validated for Store review.
- [ ] **P4-02** Self-host the model on **Cloudflare R2** (decision 2026-08-03) — brought forward for the web app
  Owner: unassigned
  Scope: R2 chosen for **zero egress fees** (185 MB × every first visit stays cheap at scale). Serve via a custom domain with **CORP `cross-origin` + CORS + long-immutable cache** headers so `crossOriginIsolated` (COEP) holds; `env.remoteHost` + one `connect-src`; aggressive Cache API so it's one-time per browser; optionally pre-patched `tokenizer.json` to drop the shim. HF domains removed from CSP.
  DoD: cold load works from R2 only; `crossOriginIsolated === true` with the model loaded; second visit is cache-hit (no re-download); HF removed.

## P5 — Chrome Web Store

- [ ] **P5-01** Privacy policy page (one page, hosted, linked)
  Owner: unassigned
  DoD: states "100% local, no data collected" truthfully; URL in the listing.
- [ ] **P5-02** Listing assets: name **"Mechikon / מחיקון"**, icons, RTL-correct Hebrew screenshots, descriptions (he primary; en later), promo tile
  Owner: unassigned
  DoD: assets reviewed by both devs; first-load download expectation stated in the listing (NER ~185 MB + mupdf/tesseract WASM + heb tessdata) — honest one-time-download note.
- [ ] **P5-03** Verify third-party licenses for public launch
  Owner: unassigned
  Scope: dictabert-ner + its ONNX conversion; transformers.js (Apache-2.0); tesseract.js (Apache-2.0);
  **`mupdf.js` — AGPL-3.0**. **Decision 2026-08-03: open-source the whole web app under an
  AGPL-compatible license** (option a) — satisfies MuPDF's network-use copyleft, aligns with TR-04,
  and *strengthens* the trust story for lawyers ("read the code — nothing is uploaded"). No Artifex
  commercial license needed. Still confirm dictabert-ner + ONNX conversion terms allow redistribution.
  Also: tesseract.js + `heb` tessdata_best (Apache-2.0, OK); hash-wasm (MIT). **Record the OCR-alternative
  rejection rationale (Fable 5)** so it isn't relitigated: PaddleOCR & EasyOCR have no Hebrew model;
  Surya has no WASM path + revenue-capped weights (Open Rail-M); no printed-Hebrew TrOCR checkpoint
  exists; DICTA ships no OCR models. Tesseract is the only client-side Hebrew OCR in 2026.
  DoD: LICENSE (AGPL-compatible) added; per-artifact confirmation in `docs/`; OCR rationale noted; blockers escalated before submission.
- [ ] **P5-04** Data-safety form ("no data collected") + submit + iterate on review
  Owner: unassigned
  DoD: extension published or review feedback triaged into tasks.
- [ ] **P5-05** "Install the extension" CTA on the BAI-hosted web app → links to the Chrome Web Store listing
  Owner: unassigned
  Scope: Chrome removed inline install (2018) — this is a link/button to the CWS page, not an in-page install. Lives on the BAI-embedded tool (P2W-06); converts web visitors into returning users (see CLAUDE.md web-first decision).
  DoD: CTA present on the public BAI tool page; links to the live CWS listing (depends on P5-04 published).

## TR — trust & verifiability (cross-cutting — see `docs/trust.md`)

Turns the core claim ("PII never leaves the device") from a promise into something the user —
especially a risk-averse Israeli lawyer — can verify. This is the moat vs competitors who say
"trust our server."

- [ ] **TR-01** Strict CSP: `connect-src` locked to only the model host; publicly documented
  Owner: yehieladam
  Scope: browser-enforced boundary (not a code promise). **Web app CSP ADDED (code review 2026-08-04):** `web/vite.config.ts` (dev/preview) + `web/vercel.json` — `default-src 'self'`, `connect-src 'self'` + the HF model hosts, `object-src/base-uri/form-action` locked, `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`. **Tighten `connect-src` to `'self'` once the model self-hosts on R2 (P4-02).** Extension side already has its MV3 CSP.
  DoD: CSP present and verified in both surfaces (web ✅, extension has MV3 CSP); a doc note explains what it blocks and why. Runtime-verify no request is blocked once the model flow lands.
- [ ] **TR-02** Extension published with zero network/host permissions; surface it in the UI
  Owner: unassigned
  Scope: manifest requests no host permissions / no network; Chrome then attests the extension cannot reach the network. Show this to the user as a trust signal.
  DoD: manifest has zero network perms; UI/store copy states "Chrome confirms this extension cannot access the network."
- [ ] **TR-03** Zero signup / account / cookies / telemetry — hard rule, stated as a trust argument
  Owner: unassigned
  Scope: enforce (nothing collected, no analytics, no cookies) and make it explicit in UI + privacy page. "Can't leak what we never collected."
  DoD: verified no cookies/storage-beyond-model, no analytics; claim stated truthfully in UI and P5-01.
- [ ] **TR-04** Open-source engine + web app; SRI + published build hash for the web deploy
  Owner: unassigned
  Scope: closes the "deployed JS != public source" gap for the web surface (the extension is the trust anchor; web needs SRI + a comparable published hash).
  DoD: repo public; web build emits an integrity hash users/experts can compare; documented in trust.md.
- [ ] **TR-05** Independent third-party security audit, report published (LATER)
  Owner: unassigned
  DoD: audit performed; report linked from the site.
- [ ] **TR-06** "We publish our misses" page — measured numbers (Fable 5)
  Owner: unassigned
  Scope: publish real measured recall — NER recall vs `ner_testset.json`, and OCR recall per scan-quality tier (from OCR-01). "We publish our misses" is a trust weapon no server competitor will match, and it enforces the "real detection only" honesty.
  DoD: page live with current numbers; updated when the engine/model changes.

## P6 — PDF (IN v1 — decision 2026-08-03; unified launch, spike-gated)

PDF is the format lawyers actually use, so v1 ships it. The enabler: **`mupdf.js`** — the WASM build
of MuPDF (the same engine behind the server's PyMuPDF), whose `page.applyRedactions()` does **true
content removal in the browser, zero server**. Scanned PDFs use **`tesseract.js`** OCR. The open risk
is **Hebrew OCR accuracy on scans**, not feasibility. Why not the existing VPS tool: uploading the PDF
to a server = PII leaves the device = breaks the whole promise; the VPS tool is a separate server-side
product, not this client-side one.

**Engine/DOM boundary:** `mupdf.js` is pure WASM → lives in `engine/`. mupdf renders page pixmaps in
pure WASM (feeds tesseract with no Canvas). **Image-pixel destruction VERIFIED (PDF-05a):**
`REDACT_IMAGE_PIXELS` + the PII rects whitens only the covered pixels on a real raster scan while
keeping the rest of the image (PDF-01's "unverified" was a fixture artifact). The whole scanned pipeline
stays in `engine/` WASM.

**⚠️ CRITICAL — save options (PROVEN in PDF-01, corrects the earlier note).** "Not incremental" is
**necessary but NOT sufficient**. `applyRedactions` orphans the old page content stream; a plain full
rewrite — even `{compress:true}` — still serialises that orphan, so the PII stays **byte-recoverable
with a single `%%EOF`**. Only **garbage collection** drops it. Proven matrix:
`{incremental:true}` → LEAKS (2× EOF) · `{}` and `{compress:true}` → **LEAK** (1× EOF, byte scan still
finds PII) · `{garbage:"deduplicate"|"compact", compress:true, sanitize:true}` → **TRUE REMOVAL**.

**Non-negotiable acceptance test — THREE layers, enforced in code + CI (hardened by PDF-01):**
1. structured text re-extract → no PII;
2. **raw-byte scan** for PII in UTF-8, UTF-16, AND reversed/visual-order forms — this is the REAL gate
   (it, not the `%%EOF` count, catches the missing-garbage leak). **Must skip embedded font/image
   binaries** (a CID font's internal `0123456789` table false-positives on short numeric needles);
3. file-structure check: single `%%EOF` — a supporting signal only. **Note the CID blind spot:** in an
   embedded Type0/CID PDF, PII is stored as glyph IDs + hex ToUnicode and appears in NO UTF-8/16 bytes,
   so Layer B is blind there and Layer C is what catches an incremental leak. Use all three.
Never a black box over live text.

- [x] **PDF-01** Feasibility spike — **DONE, verdict GO for the text pipeline** (`feat/pdf-01-spike`, `spikes/pdf-01/FINDINGS.md`)
  Owner: yehieladam (spike)
  Result: `mupdf` 1.28.0 does true, client-side, server-free PII removal; full 3-layer test passes on Latin AND a real Hebrew fixture (embedded Arial Type0). WASM 9.93 MiB / **3.44 MiB brotli**; ~5 ms/page Latin, ~15 ms/page Hebrew; redacted output re-opens/renders fine. (The "image-pixel redaction unverified" caveat here was later RESOLVED by PDF-05a — it works with PII rects on a real scan.) PyMuPDF #434 segfault did NOT reproduce. Exact save options handed to PDF-04.
- [ ] **PDF-02** Feasibility spike: `tesseract.js` Hebrew OCR (GO/NO-GO gate) — use `tessdata_best` `heb`
  Owner: unassigned
  Scope: OCR synthetic scanned Hebrew pages; confirm mupdf pixmap → tesseract works with no Canvas; spike PSM 4/6, `preserve_interword_spaces`, dictionary on/off (legal names are out-of-dictionary — the dawg can "correct" a real name into a wrong one). Feeds OCR-01 harness.
  DoD: GO/NO-GO; confirms no-Canvas path; knob findings recorded.
- [ ] **PDF-03** PDF text extraction + bidi mapping (Hebrew reading order) via `mupdf.js`
  Owner: unassigned
  Scope: **CONFIRMED by PDF-01** — MuPDF extracts Hebrew runs in **reversed visual order** (`ישראל ישראלי` comes back `ילארשי לארשי`), so a forward `search()` returns **0 hits**; and the ASCII hyphen round-trips as **U+00AD**, splitting `052-1234567` into `052`+`1234567`. **Never locate detections by string-searching extracted text** — build a per-glyph logical↔visual index map and derive redaction rects from **glyph quads**; normalise separators (U+00AD→`-`) and strip bidi controls before matching.
  DoD: text + positions extracted; **mixed RTL/LTR + digits + hyphenated-number fixture** redacts at correct rects; a naïve `includes()` match is proven insufficient in tests; feeds recognizers + NER unchanged.
- [ ] **PDF-04** PDF redaction output pipeline: detections → glyph-quad rects → `applyRedactions()` → redacted PDF
  Owner: unassigned
  Scope: depends on PDF-01 GO (achieved). **Copy the PROVEN save options exactly:**
  ```js
  page.applyRedactions(true, PDFPage.REDACT_IMAGE_PIXELS, PDFPage.REDACT_LINE_ART_NONE, PDFPage.REDACT_TEXT_REMOVE);
  const bytes = doc.saveToBuffer({ garbage: "deduplicate", compress: true, sanitize: true }).asUint8Array();
  // NEVER { incremental: true }; NEVER a plain save without garbage — both LEAK.
  ```
  DoD: real Hebrew PDF in → truly redacted PDF out; **3-layer acceptance test enforced in code** (byte-scan is the gate; self-verify, assert no PII); RTL correct.
- [x] **PDF-05a** Spike — scanned-image redaction + Hebrew OCR feasibility (**DONE, GO**; `feat/pdf-05a-spike`, `spikes/pdf-05a/FINDINGS.md`)
  Owner: yehieladam (spike)
  Result: native `applyRedactions(true, REDACT_IMAGE_PIXELS, REDACT_LINE_ART_NONE, REDACT_TEXT_REMOVE)` + PII rects + `{garbage:"deduplicate",compress:true,sanitize:true}` → true pixel destruction of only the PII regions (image kept). `REDACT_IMAGE_REMOVE` wipes the whole image — do NOT use. OCR (tessdata_best `heb`+`eng`, PSM 6): clean 150/300 DPI = 96.6% char acc, all PII; **noisy scan missed a name** (leak). Weight: ~21 MiB (tesseract 2.73 + heb 3.53 + **eng 14.69, required for digits**).
- [ ] **PDF-05** Scanned-PDF (OCR) redaction — native `REDACT_IMAGE_PIXELS` + PII rects (method proven, PDF-05a)
  Owner: unassigned
  Scope: OCR (heb+eng) → word boxes → map to page-space PII rects → `applyRedactions(REDACT_IMAGE_PIXELS…)` + garbage save (snippet in `spikes/pdf-05a/FINDINGS.md`). Verify by **re-OCR of the redacted region** (assert no text). Lazy-load heb+eng+tesseract only on scan use (P0I-02). **Gated on OCR-03** — a low-quality scan must refuse, never silently under-redact (PDF-05a proved noisy scans miss entities).
  DoD: scanned Hebrew PDF in → redacted output; re-OCR of redacted regions finds nothing; low-confidence scans hit the OCR-03 refusal path.
- [ ] **PDF-06** PDF sanitize pass — metadata & non-visible leak channels (Fable 5)
  Owner: unassigned
  Scope: redaction ≠ sanitization. Strip/clean: Info dict + **XMP metadata**, embedded files/attachments, annotation contents, form field values, **bookmarks/outlines** (often carry party names in legal PDFs), image EXIF/XMP.
  DoD: raw-byte scan of output finds none of the above; unit fixtures per channel.

## OCR — Hebrew accuracy & honesty (extends P6, gates scan mode)

> **PDF-05a measured (seed data):** tessdata_best `heb`+`eng` (eng REQUIRED for digits — ID/phone),
> PSM 6 — clean 150/300 DPI ≈ 96.6% char accuracy, all PII recovered; **noisy+skew 150 DPI missed a
> name** (id/phone still caught). Confirms the leak mode is real → OCR-03 is mandatory. Weight ~21 MiB.

- [ ] **OCR-01** Hebrew OCR recall harness (hard GO/NO-GO gate for scan mode)
  Owner: unassigned
  Scope: synthetic Hebrew legal-style pages with **planted synthetic PII** → rasterize at 150/300 DPI with noise/skew/JPEG → OCR (heb+eng) → score TWO numbers per quality tier: char accuracy AND **end-to-end PII recall**. Extends the PDF-05a seed with more entities/tiers. Every miss = leak.
  DoD: published numbers per scan-quality tier; **threshold set below which scan redaction is refused** (feeds OCR-03).
- [ ] **OCR-02** Pure-TS in-engine preprocessing (adopt only what measurably lifts OCR-01 recall)
  Owner: unassigned
  Scope: grayscale → Otsu binarization → deskew (projection profile) → upscale to ≥300 DPI-equivalent, operating on RGBA buffers (no OpenCV.js needed) — framework-free, in `engine/`. PDF-05a showed noise/skew is exactly what breaks recall — deskew/denoise are the priority.
  DoD: each step kept only if it improves the OCR-01 number; measured deltas recorded.
- [ ] **OCR-02** Pure-TS in-engine preprocessing (adopt only what measurably lifts OCR-01 recall)
  Owner: unassigned
  Scope: grayscale → Otsu binarization → deskew (projection profile) → upscale to ≥300 DPI-equivalent, operating on RGBA buffers (no OpenCV.js needed) — framework-free, in `engine/`.
  DoD: each step kept only if it improves the OCR-01 number; measured deltas recorded.
- [ ] **OCR-03** Confidence surfacing + honest refusal — **MANDATORY for scan mode (PDF-05a proved the leak)**
  Owner: unassigned
  Scope: per-word tesseract confidence → page-level trust indicator + review UI; below the OCR-01 threshold **refuse**: "we cannot reliably redact this scan" — never a silent partial redaction (a noisy scan already missed a name in PDF-05a). The "real detection only" rule applied to OCR; ties to the TR honesty story. Blocks shipping scan mode.
  DoD: confidence visible; refusal path works and blocks output below threshold; wording reviewed.
