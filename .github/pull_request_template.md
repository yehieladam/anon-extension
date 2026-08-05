## What & why

<!-- One or two sentences: what changed and why. Link the task id from docs/tasks.md (e.g. P1-03). -->

Task:

## Checklist

- [ ] Task was claimed in `docs/tasks.md` (Owner set) before work started
- [ ] Tests added/updated for the change (unit for engine logic; NER changes re-ran recall vs `browser-poc/ner_testset.json`)
- [ ] `npm run typecheck` green locally
- [ ] `npm run lint` green locally
- [ ] `npm test` green locally
- [ ] No PII and no secrets in code, tests, or fixtures (synthetic data only)
- [ ] No new network calls (only the one-time NER model download is allowed)
- [ ] `engine/` stayed framework-free (no React/DOM/`chrome.*` imports)
- [ ] The plain-JS spike in `extension/` untouched (until P2-01 retires it)
- [ ] Docs updated if behavior or stack changed (`docs/STACK.md` / `docs/tasks.md`)

## How I tested

<!-- Commands run + what you observed. Real results only — never fabricated. -->
