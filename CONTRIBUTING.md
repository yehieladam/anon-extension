# Contributing — the working agreement

This file is the source of truth for how changes land: the workflow, the layering rules, and the
Definition of Done. Read it before opening a PR.

## The golden path (every change)

1. **Claim the task first.** Open `docs/tasks.md` (or the GitHub Issue), put your handle in the
   task's `Owner:` field, and push that tiny change (or comment on the Issue). Only then start
   coding. This is how we avoid both of us building the same recognizer on the same afternoon.
2. **One branch per task** (not per person): `feat/<task-id>-short-name`, `fix/…`, `chore/…`,
   `docs/…`, `test/…`, `refactor/…`. Examples: `feat/p1-03-israeli-phone`, `fix/ner-offsets`.
3. **Small PRs.** One task = one PR. If a PR is growing past ~400 lines of real diff, split it.
4. **Rebase on `main` often** (`git fetch origin && git rebase origin/main`) — especially before
   opening the PR and before merging.
5. **Green before PR.** Run locally:

   ```
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```

6. **PR → CI green → review → merge.** Never push directly to `main` (it is protected).
7. **Conventional commits**, English, no emoji: `feat: …`, `fix: …`, `chore: …`, `docs: …`,
   `test: …`, `refactor: …`. Say *what and why*, not just what.

## Local commands (Windows, Node 20, npm)

```
nvm use            # or make sure node -v is 20.x (.nvmrc)
npm install        # first-time setup (commits package-lock.json changes)
npm run dev        # Vite dev server for the NEW React popup build (HMR)
npm run build      # production build -> dist/ (loadable MV3 extension)
npm run typecheck  # tsc --noEmit (strict)
npm run lint       # eslint (flat config, ignores extension/ + browser-poc/)
npm run format     # prettier -w .
npm test           # vitest run (CI-equivalent)
npm run test:watch # vitest watch mode
```

## Layering rules (enforced, do not bend)

- `engine/` is **framework-free**: no React, no DOM, no `chrome.*`. ESLint blocks React imports
  there; reviewers block the rest. If you need a browser API you are in the wrong layer.
- `extension/` (the hand-built plain-JS MV3 spike) is **frozen as the working proof** — do not
  modify or break it. It stays loadable until the React/Vite build (rooted at `src/` +
  `src/manifest.config.ts`) replaces it in **P2** (task P2-01 in `docs/tasks.md`). New UI work
  goes in `src/`, never in `extension/`.
- No new network calls anywhere — the only allowed fetch is the one-time NER model download.

## Definition of Done (the PR template checks these)

- Code + tests (unit for engine logic; NER changes re-run recall vs `browser-poc/ner_testset.json`).
- `typecheck`, `lint`, `test` green locally and in CI.
- No PII/secrets; no new network calls; engine stays framework-free.
- Docs updated if behavior/stack changed.

## Licensing note

The repo is **AGPL-3.0-or-later** (see `LICENSE`) — required by `mupdf.js` (AGPL-3.0) and embraced
as a trust asset ("read the code — nothing is uploaded"). Third-party model/library licenses —
`dicta-il/dictabert-ner` (and its ONNX conversion) and `@huggingface/transformers` (Apache-2.0) —
must be **verified for redistribution/commercial terms before any public Store launch**; they are
not yet confirmed cleared.
