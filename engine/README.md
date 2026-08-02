# engine/ — reusable client-side detection engine (P1, not built yet)

Framework-free JS. No DOM, no extension APIs — so the SAME module powers the Chrome extension
and a future web app. Ported from the Python server (`../` original project) and the Phase-0 spike.

Planned modules (see `../docs/chrome-extension-plan.md` §1):

- `recognizers/*.js` — deterministic regex+checksum: ת"ז (Luhn), טלפון, IBAN, ח"פ, תיק,
  גוש-חלקה, פוליסה, מבוטח, email. Port of the server's `src/recognizers/*`.
- `ner.js` — transformers.js `token-classification` wrapper for `dictabert-ner-ONNX` (q8),
  including the Phase-0 fixes: the RegExp shim (`\"`/`\'` illegal under `/u`) and offset/`##`
  reconstruction. See `../browser-poc/PHASE0_FINDINGS.md`.
- `resolve.js` — overlap resolution (port of the server's `analyze.py` PRIORITY logic).
- `anonymize.js` — typed Hebrew placeholders + reversible key (port of `anonymize.py`).
- `restore.js` — placeholders → originals. POST-MVP (MVP is anonymize-only), but the key is still
  produced so restore can be added without rework.

Test targets: each JS recognizer against the same valid/invalid cases as the server's
`check_task1.py`; NER recall against `../browser-poc/ner_testset.json` (target ≈ 88.89% parity).
