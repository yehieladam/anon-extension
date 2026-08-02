# engine/ — reusable client-side detection engine (TypeScript, P1 in progress)

Framework-free **TypeScript** (`engine/src/`). No DOM, no React, no extension APIs — so the SAME
module powers the Chrome extension popup and a future web app. Ported from the Python server
(`pii-anonymizer-spike`) and the Phase-0 spike. Import it via the `@engine/*` path alias
(configured in `tsconfig.json` / `vite.config.ts` / `vitest.config.ts`).

Built so far (chore/foundation):

- `src/types.ts` — `EntityType`, `Span`, `Recognizer`, `KeyRow`, `AnonymizeResult`, and the
  server-parity `PRIORITY` overlap map.
- `src/recognizers/israeliId.ts` — ת"ז with the REAL Luhn checksum (port of the server's
  `israeli_id.py`), unit-tested against the same valid/invalid IDs as the server's `check_task1.py`.
- `src/index.ts` — the public barrel.

Remaining P1 modules and their task ids live in `../docs/tasks.md` (P1-03..P1-15): the other
deterministic recognizers (טלפון, ח"פ, IBAN, תיק, גוש-חלקה, פוליסה, מבוטח, email), `ner.ts`
(transformers.js wrapper — MUST carry the Phase-0 tokenizer `/u` shim and offset/`##`
reconstruction, see `../browser-poc/PHASE0_FINDINGS.md`), `resolve.ts`, `anonymize.ts`, `key.ts`,
and `restore.ts` (**in the MVP** — decision 2026-08-02).

Test targets: each recognizer against the same valid/invalid cases as the server's checks;
NER recall against `../browser-poc/ner_testset.json` (target ≈ 88.89% parity).
