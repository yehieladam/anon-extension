# P1-11 plan — `engine/src/ner.ts`, the NER wrapper

> Status: **DRAFT, awaiting approval** (CLAUDE.md hard rule 6). Branch: `feat/p1-11-ner`.
> Decisions below were taken with @nadavnbs on 2026-08-03.

## Goal

Turn dictabert's raw token predictions into clean, non-overlapping `Span[]` with **real
character offsets**, so `anonymize.ts` (P1-13) can replace exact ranges of the source text.

**DoD (from `docs/tasks.md`):** recall vs `browser-poc/ner_testset.json` ≥ 88.89% (server
parity); unit tests for offset and `##` reconstruction against recorded model outputs.

## What the probes established (verified, not assumed)

Four things were checked directly against transformers.js 4.2.0 before writing this plan.

1. **The tokenizer exposes no offsets at all.** `return_offsets_mapping` and `return_offsets`
   are silently ignored — the returned keys are only `input_ids`, `attention_mask`,
   `token_type_ids`. There is no supported way to ask the library for character positions.
2. **The token list is recoverable, and `index` maps into it 1:1.** `tokenizer._encode_text(text)`
   returns the full token list *including* `[CLS]` and `[SEP]`, and the `index` on each raw
   prediction indexes directly into that array. Verified token by token:
   `index=3 → "רחל"`, `index=5 → "##-"`, `index=13 → "בתל"`.
3. **Walking those tokens over the source text yields exact spans.** Stripping `##` and
   scanning forward re-anchors every non-special token. The hyphenated name that cost Phase 0
   seven recall points reconstructs contiguously:

   ```
   רחל | לוי | ##- | ##אבר | ##מוביץ
   11-14 15-18 18-19 19-22   22-27      ->  לוי-אברמוביץ = [15, 27)
   ```

   So `##` is not a string-cleanup problem. It disappears structurally.
4. **Labels are plain BIO** (`B-PER`, `I-PER`, `B-GPE`, …), so grouping is ours to do and is
   straightforward.

The consequence: **P1-11 is no longer the project's risk item.** What looked like fuzzy string
re-alignment is a deterministic index join. The residual risks are in §5, and they are smaller.

## 1. Decisions

| Decision | Choice | Why |
|---|---|---|
| Offset strategy | **Token alignment** — `aggregation_strategy: "none"`, align tokens to text, group BIO ourselves | Exact offsets; fixes `##` structurally; no dependence on how the library formats surfaces |
| Entity scope | **PERSON, ORGANIZATION, LOCATION only** | Matches the server and the Phase-0 baseline, so 88.89% stays directly comparable |
| `TIMEX` / `TTL` / `DUC` | **Dropped** | Not PII for this product; `DUC` is also the unstable tag that flipped between backends |
| Recall harness runtime | **Browser, WASM, via `playwright-core`** | Measure the runtime we actually ship. Phase 0 produced the baseline the same way, so the number is like-for-like |
| PR scope | **Engine + tests only**, no UI | Keeps the PR near CONTRIBUTING's ~400-line guidance; highlighting lands in P2-02 |

Tag mapping, carried over from the server and Phase 0 unchanged:
`PER → PERSON`, `ORG → ORGANIZATION`, `GPE | LOC | FAC → LOCATION`, everything else dropped.

## 2. Shape of the code

The point of the split below is that **almost all the logic is pure and testable offline**.
Only one thin layer needs the 185 MB model.

```
engine/src/ner.ts            the public facade: runNer(text) -> Span[]
engine/src/ner/tokenAlign.ts PURE: (text, tokens) -> per-token char ranges
engine/src/ner/bioGroup.ts   PURE: (predictions, ranges) -> merged Span[] with the tag map
engine/src/ner/tagMap.ts     PURE: model tag -> EntityType | null
```

`tokenAlign` and `bioGroup` never touch the model, so their unit tests run in milliseconds
against **recorded fixtures** — which is exactly what the DoD asks for ("recorded model
outputs"). `ner.ts` is the only part that needs a pipeline.

Layering: `ner.ts` may import `@huggingface/transformers` (the engine's one allowed runtime
dependency) but must not touch `chrome.*` or the DOM. The shell still owns `wasmPaths` and
`numThreads` via `src/popup/ortSetup.ts`, and calls `installTokenizerShim()` before the first
pipeline — unchanged from P2-01.

## 3. The recall harness

`scripts/recall.mjs`, run as `npm run recall`. Adds **`playwright-core`** as a devDependency —
justified: it is how Phase 0 measured the baseline, and browser WASM is the only way to
measure what actually ships.

- Loads the built extension, forces the WASM backend, runs all 21 sentences from
  `browser-poc/ner_testset.json`.
- Same containment match rule and the same tag mapping as `run_server_baseline.py`, compared
  against `browser-poc/server_baseline.json`.
- Prints per-type and overall recall; **exits non-zero below 88.89%** so it can gate a PR.
- Writes a JSON report so runs are diffable across changes.

Not wired into CI in this PR — CI would need a browser download. It runs locally before any
NER change merges; wiring it into GitHub Actions is a follow-up worth doing separately.

## 4. Verification

1. `tokenAlign` unit tests: hyphenated names, `##` continuations, repeated values, specials,
   punctuation, mixed Hebrew/Latin, and the explicit failure path in §5.
2. `bioGroup` unit tests: `B-`/`I-` runs, adjacent same-type entities that must NOT merge,
   a lone `I-` with no `B-`, and dropped tags.
3. Property test: every returned `Span` satisfies `text.slice(start, end)` equal to the
   entity surface with no `##` present.
4. `npm run recall` ≥ 88.89%.
5. Existing gates stay green; `dist/` still loads and runs.

## 5. Residual risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Alignment fails when a token's surface is not literally in the text** — the tokenizer may lowercase or strip accents on Latin text, and `[UNK]` has no surface at all | **Medium — the main one now** | Case-insensitive fallback, explicit `[UNK]` handling, and a hard failure (never a silent wrong offset) when a token cannot be anchored. A wrong offset would redact the wrong characters, so this must fail loudly |
| `_encode_text` is a private API (leading underscore) and could change | Low | transformers is already pinned to 4.2.0; a unit test asserts `index` still lines up with the token list, so an upgrade breaks loudly |
| Backends disagree on marginal predictions (found in P2-01) | Known | Harness is pinned to WASM, which is why that decision was made |
| Recall lands below 88.89% | Low | Phase 0 already measured 88.89% once the `##` artifact is handled, and this approach handles it structurally rather than approximately |

## 6. Out of scope

Overlap resolution (P1-12), placeholders (P1-13), the key (P1-14), restore (P1-15), any UI,
and the Hebrew prefix problem — `בתל אביב`, where the preposition is fused into the token and
cannot be split at the token level. That is P1-13's decision and is recorded there.

`src/popup/nerParity.ts` is deleted when this lands, as planned in P2-01.

## 7. Estimate

1.5–2 days. The pure logic is a day with its tests; the harness and getting the recall number
to actually reproduce is the rest.
