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
  Owner: nadavnbs (`feat/p1-11-ner`) — plan: `docs/plans/p1-11-ner-wrapper.md`
  Scope: WASM default + `numThreads=1`; the Phase-0 tokenizer `\"`/`\'` `/u` shim; reconstruct null char offsets; strip/re-join `##` wordpieces (hyphenated names). See `browser-poc/PHASE0_FINDINGS.md` — all three fixes are mandatory.
  Decided 2026-08-03: **token alignment**, not string re-matching — `aggregation_strategy: "none"`, align each token to the source text, group the BIO tags ourselves. Probes confirmed the tokenizer exposes no offsets, but `index` maps 1:1 into `tokenizer._encode_text(text)`, and walking those tokens re-anchors every entity exactly — `##` dissolves structurally. Entity scope is **PERSON/ORGANIZATION/LOCATION only**; `TIMEX`/`TTL`/`DUC` are dropped. Recall harness runs **browser WASM via playwright-core** (measure the runtime we ship; matches how Phase 0 produced the baseline).
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

## P2 — popup UX (React shell in `src/`, imports `@engine/*`)

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
- [ ] **P2-05** Restore flow UI: upload key + anonymized text → originals (MVP, uses P1-15)
  Owner: unassigned
  DoD: round-trip works in the popup on a real anonymized doc + its key.
- [ ] **P2-06** Manual blackout — the user selects any text and marks it for redaction (**MVP**)
  Owner: unassigned
  Added 2026-08-03 (@nadavnbs) — new requirement, not in the original plan. This is the
  inverse of P2-04: P2-04 rescues words the tool wrongly flagged, P2-06 redacts words the
  model never caught. At 88.89% recall the model will miss things, and this is the honest
  answer to that — the user is not left with no recourse.
  Scope: selection in the input maps to a character range, joins the resolved spans as a
  first-class entity, and threads through the preview, the key CSV and restore exactly like a
  detected span (so P1-14/P1-15 must exist first). Needs its own placeholder type.
  DoD: a manually marked range anonymizes and restores losslessly, round-tripped in the popup.

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
- [ ] **P5-03** Verify third-party licenses for public launch (dictabert-ner, its ONNX conversion, transformers.js Apache-2.0)
  Owner: unassigned
  DoD: written confirmation per artifact in `docs/`; blockers escalated before submission.
- [ ] **P5-04** Data-safety form ("no data collected") + submit + iterate on review
  Owner: unassigned
  DoD: extension published or review feedback triaged into tasks.

## Separate track — PDF in-place redaction spike (own timeline, NOT coupled to MVP)

- [ ] **PDF-01** Research spike: pdf-lib true in-place redaction feasibility in the browser
  Owner: unassigned
  Scope: re-examine the server's hard-won word-run matching + box-fitting logic (memories `pdf-inplace-redaction-requirement`, `pdf-redaction-precise-matching`); treat as research-risk, not a feature ticket.
  DoD: written GO/NO-GO with a demo or a documented dead end.
