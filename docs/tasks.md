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
- [ ] **P1-03** `recognizers/israeliPhone.ts` — IL_PHONE (mobile + landline formats)
  Owner: unassigned
  DoD: port of `israeli_phone.py` regexes; unit tests cover 052-/03- style samples + negatives.
- [ ] **P1-04** `recognizers/israeliCompany.ts` — IL_COMPANY (ח"פ, checksum like ID)
  Owner: unassigned
  DoD: port of `israeli_company.py`; valid/invalid checksum tests.
- [ ] **P1-05** `recognizers/israeliIban.ts` — IL_IBAN (IL + mod-97)
  Owner: unassigned
  DoD: port of `israeli_iban.py` incl. real IBAN mod-97 validation; tests with valid/invalid IBANs.
- [ ] **P1-06** `recognizers/israeliCase.ts` — IL_CASE (מספר תיק)
  Owner: unassigned
  DoD: port of `israeli_case.py`; pattern + context tests.
- [ ] **P1-07** `recognizers/israeliLand.ts` — IL_LAND (גוש/חלקה)
  Owner: unassigned
  DoD: port of `israeli_land.py`; pattern + context tests.
- [ ] **P1-08** `recognizers/israeliPolicy.ts` — IL_POLICY (מספר פוליסה)
  Owner: unassigned
  DoD: port of `israeli_policy.py`; pattern + context tests.
- [ ] **P1-09** `recognizers/israeliInsured.ts` — IL_INSURED (מספר מבוטח)
  Owner: unassigned
  DoD: port of `israeli_insured.py`; pattern + context tests.
- [ ] **P1-10** `recognizers/email.ts` — EMAIL_ADDRESS (replaces Presidio's built-in)
  Owner: unassigned
  DoD: RFC-sane regex; tests incl. `.co.il` addresses; no false hits on plain Hebrew text.
- [ ] **P1-11** `ner.ts` — transformers.js token-classification wrapper (dictabert-ner-ONNX q8)
  Owner: unassigned
  Scope: WASM default + `numThreads=1`; the Phase-0 tokenizer `\"`/`\'` `/u` shim; reconstruct null char offsets; strip/re-join `##` wordpieces (hyphenated names). See `browser-poc/PHASE0_FINDINGS.md` — all three fixes are mandatory.
  DoD: recall harness vs `browser-poc/ner_testset.json` ≥ 88.89% (server parity); unit tests for offset/`##` reconstruction with recorded model outputs.
- [ ] **P1-12** `resolve.ts` — overlap resolution (PRIORITY map, deterministic > NER)
  Owner: unassigned
  DoD: port of server `analyze.py` `PRIORITY` + greedy keep-strongest; tests for ID-inside-NER-span and adjacent-span cases; output non-overlapping, reading order.
- [ ] **P1-13** `anonymize.ts` — typed Hebrew placeholders (`[שם_1]`, `[ת"ז_1]`), consistent per surface value
  Owner: unassigned
  DoD: port of server `anonymize.py`; same value → same placeholder; numbering in reading order; tests.
- [ ] **P1-14** `key.ts` — reversible mapping rows + CSV serialization (restore-compatible)
  Owner: unassigned
  DoD: KeyRow[] → CSV and back, lossless round-trip test; format matches the server key CSV columns.
- [ ] **P1-15** `restore.ts` — placeholders → originals using the key (**MVP** — see decision note above)
  Owner: unassigned
  DoD: restore(anonymize(text)) === text property test on synthetic docs; handles repeated placeholders and missing-key errors explicitly.

## P2W — web app (public front door, ships first — see CLAUDE.md decision 2026-08-02)

**Owner of this track: @yehieladam** (division of labor, decided 2026-08-03: Yehiel → web app,
Nadav → extension). Still set `Owner:` per task when claiming.

The **web app is the first public surface** (zero install, best reach, no Store review, and it can run
`crossOriginIsolated` → multi-threaded WASM → faster NER). Reuses `@engine/*` unchanged. The popup
below (P2) becomes the **fast-follow** extension. Both share the engine — this is go-to-market ordering.

**Delivery decision (2026-08-03):** the web interface is built here, then **embedded into the public
BAI website** (`bai-solutions`) as the public tool, with a **link to install the extension** for users
who want the always-on version. Open question to resolve in P2W-06: dedicated isolated route/subdomain
vs iframe inside an existing BAI page — because `crossOriginIsolated` needs COOP/COEP headers on the
top document, which can break third-party scripts elsewhere on the BAI site. If isolation isn't
achievable on BAI infra, NER falls back to `numThreads=1` (works, just slower) — not a blocker.

- [ ] **P2W-01** React + Vite web app shell on static hosting (Vercel/CDN), imports `@engine/*`
  Owner: unassigned
  Scope: serve with COOP/COEP headers so the page is `crossOriginIsolated` → `numThreads > 1` for WASM (unlike the MV3 popup); vendor onnxruntime `.mjs`+`.wasm`; model from HF CDN for now (self-host in P4-02).
  DoD: `npm run build` web target deploys; NER runs in-browser; no PII network calls (only model fetch).
- [ ] **P2W-02** Paste flow end-to-end: detect → highlight by type → anonymized copy → download key
  Owner: unassigned
  DoD: real detections only; RTL correct; per-type counts; mirrors P2-02 but on the web surface.
- [ ] **P2W-03** "Anonymize before the AI" round-trip UI: paste an AI reply containing placeholders → restore originals (uses P1-15)
  Owner: unassigned
  Scope: the killer use case both competitors monetize (see `docs/differentiation.md`) — strip PII → send sanitized text to ChatGPT/Claude → paste the answer back → real values restored. All in-browser; the token→value map lives only in the tab.
  DoD: full round-trip works on a real doc + its key; restored answer matches originals; missing-key handled explicitly.
- [ ] **P2W-04** "Zero network" proof surface (turn the privacy claim into something verifiable)
  Owner: unassigned
  Scope: small badge/panel stating "0 network requests (except the one-time model download)"; extend the WASM badge from the spike. Makes the marketing claim (`docs/marketing.md`) concrete.
  DoD: badge reflects real state; no false claim; visible in the UI.
- [ ] **P2W-05** Organic design tokens (cream/terracotta/sage, Suez One/Rubik) on the web app
  Owner: unassigned
  DoD: matches approved design system; RTL + LTR both checked.
- [ ] **P2W-06** Embed the web interface into the public BAI website + "install the extension" link
  Owner: unassigned
  Scope: decide dedicated isolated route/subdomain vs iframe in an existing BAI page (see the isolation caveat above); wire the CWS install link (P5-05). Keep the tool page self-contained so its COOP/COEP don't have to fight the rest of the BAI site.
  DoD: tool reachable on the public BAI site; runs in-browser with no PII network calls; extension-install link present; isolation approach documented (and NER perf noted if it fell back to numThreads=1).

## P2 — popup UX (Chrome extension, fast-follow after P2W; React shell in `src/`, imports `@engine/*`)

**Owner of this track: @nadavnbs** (division of labor, decided 2026-08-03). Still set `Owner:` per task when claiming.

- [ ] **P2-01** Migrate the spike into the Vite/crxjs build (retire `extension/` as the loadable)
  Owner: unassigned
  Scope: vendor onnxruntime `.mjs`+`.wasm` into the built output, `wasmPaths` override, `numThreads=1`, CSP `'wasm-unsafe-eval'` + `connect-src` (plan §3) — the spike stays untouched until this build is verified load-unpacked in Chrome.
  DoD: `npm run build` output loads unpacked; NER runs; spike parity confirmed; then `extension/` may be archived.
- [ ] **P2-02** Paste flow end-to-end: detect → highlight by type → anonymized copy → download key
  Owner: unassigned
  DoD: real detections only; RTL correct; per-type counts shown.
- [ ] **P2-03** Organic design tokens (cream/terracotta/sage, Suez One/Rubik) on the popup
  Owner: unassigned
  DoD: matches the approved design system; RTL + LTR both checked.
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
- [ ] **P4-02** Switch model source HF CDN → our VPS/CDN (`env.remoteHost`, one `connect-src`, CORS `*`; optionally pre-patched `tokenizer.json` to drop the shim)
  Owner: unassigned
  DoD: cold load works from self-host only; HF domains removed from CSP.

## P5 — Chrome Web Store

- [ ] **P5-01** Privacy policy page (one page, hosted, linked)
  Owner: unassigned
  DoD: states "100% local, no data collected" truthfully; URL in the listing.
- [ ] **P5-02** Listing assets: name, icons, RTL-correct Hebrew screenshots, descriptions (he+en), promo tile
  Owner: unassigned
  DoD: assets reviewed by both devs; first-load 185 MB download expectation stated in the listing.
- [ ] **P5-03** Verify third-party licenses for public launch
  Owner: unassigned
  Scope: dictabert-ner + its ONNX conversion; transformers.js (Apache-2.0); tesseract.js (Apache-2.0);
  **`mupdf.js` — AGPL-3.0 ⚠️**. AGPL is copyleft with a network-use clause: a public web app using it
  must offer its source to users. Decide NOW: (a) open-source the web app under an AGPL-compatible
  license (aligns with TR-04), or (b) obtain an Artifex commercial MuPDF license. This is a launch
  blocker for a commercially-hosted BAI tool — resolve before building on mupdf.js.
  DoD: written confirmation per artifact in `docs/`; MuPDF license path chosen and documented; blockers escalated before submission.
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
  Owner: unassigned
  Scope: browser-enforced boundary (not a code promise). After model cache, effectively no network. Document the header so it is a citable trust argument. Coordinates with P2W-01 (web) and the MV3 CSP (plan §3).
  DoD: CSP present and verified in both surfaces; a doc note explains what it blocks and why.
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

## P6 — PDF (IN v1 — decision 2026-08-03; unified launch, spike-gated)

PDF is the format lawyers actually use, so v1 ships it. The enabler: **`mupdf.js`** — the WASM build
of MuPDF (the same engine behind the server's PyMuPDF), whose `page.applyRedactions()` does **true
content removal in the browser, zero server**. Scanned PDFs use **`tesseract.js`** OCR. The open risk
is **Hebrew OCR accuracy on scans**, not feasibility. Why not the existing VPS tool: uploading the PDF
to a server = PII leaves the device = breaks the whole promise; the VPS tool is a separate server-side
product, not this client-side one.

**Engine/DOM boundary:** `mupdf.js` is pure WASM → lives in `engine/`. OCR page rendering may need
Canvas/OffscreenCanvas (DOM) → keep that in the app layer; the engine receives text + coordinates.

**Non-negotiable acceptance test:** after redaction, extract text from the OUTPUT PDF — if any PII
remains, it FAILS. Never a black box over live text.

- [ ] **PDF-01** Feasibility spike: `mupdf.js` `applyRedactions()` on a real Hebrew PDF (GO/NO-GO gate)
  Owner: unassigned
  Scope: load a Hebrew text PDF via mupdf.js, mark PII rects from detections, `applyRedactions()`, save; run the acceptance test (extract text from output → PII gone). Measure WASM size + per-page time. Re-check the server's word-run/box-fitting lessons (memories `pdf-inplace-redaction-requirement`, `pdf-redaction-precise-matching`) — mupdf likely handles what PyMuPDF did.
  DoD: written GO/NO-GO + demo; acceptance test passes; size/perf recorded. NO-GO fallback: anonymized text/DOCX output (never server).
- [ ] **PDF-02** Feasibility spike: `tesseract.js` Hebrew OCR accuracy on scanned legal PDFs (GO/NO-GO gate)
  Owner: unassigned
  Scope: OCR a set of synthetic scanned Hebrew pages; measure recall of text (and thus of PII the recognizers can then catch); weigh traineddata size + speed. Redaction on a scan = paint over image regions at OCR boxes.
  DoD: written GO/NO-GO + accuracy number; UI honesty note drafted ("scanned = accuracy depends on scan quality"); size/perf recorded.
- [ ] **PDF-03** PDF text extraction + bidi reorder (Hebrew reading order) via `mupdf.js`
  Owner: unassigned
  DoD: text + positions extracted; Hebrew reading order correct on a mixed RTL/LTR sample; feeds the recognizers + NER unchanged.
- [ ] **PDF-04** PDF redaction output pipeline: detections → rects → `applyRedactions()` → downloadable redacted PDF
  Owner: unassigned
  Scope: depends on PDF-01 GO. Same-value/consistent handling as the text flow; passes the acceptance test on every output.
  DoD: real Hebrew PDF in → truly redacted PDF out; acceptance test enforced in code (self-verify: re-extract, assert no PII); RTL correct.
- [ ] **PDF-05** Scanned-PDF (OCR) redaction pipeline: `tesseract.js` → boxes → paint-over → output
  Owner: unassigned
  Scope: depends on PDF-02 GO. Honesty in UI about OCR-dependent accuracy.
  DoD: scanned Hebrew PDF in → redacted output; missed-text caveat surfaced to the user.
