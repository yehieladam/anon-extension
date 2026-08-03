# Differentiation & Competitive Positioning

> Internal strategy doc. What sets us apart, what we learned from competitors, and the
> claims we can defend. Marketing copy derived from this lives in `marketing.md`.

## One-line positioning

**The only Hebrew PII anonymizer where your data never leaves the browser — detect,
anonymize, use with any AI, and restore, all client-side. Nobody sees your PII. Not even us.**

## The market (who we watched)

| Tool | What it is | Where PII goes | Israeli-specific | Round-trip restore |
|------|-----------|----------------|------------------|--------------------|
| **anonym.legal** | Anonymizer suite (web/desktop/ext/API/MCP) | Their servers (Germany, Hetzner) | No (generic 48-lang NER) | Yes — but token→value vault is **server-side** |
| **PolyLM Law** | Full AI legal assistant, Hebrew | Their server + downstream LLM | Weak (generic entity list) | Not exposed (prevention, not reversal) |
| **us** | Focused client-side anonymizer (ext, later web app) | **Nowhere — stays in the browser** | **Yes (regex+checksum + dictabert-ner)** | **Yes — mapping lives only in the browser** |

## Our three defensible moats

### 1. True zero-server (privacy by architecture, not by jurisdiction)
Every competitor sends text somewhere. anonym.legal's whole pitch is "your data stays in
Germany" — but it still leaves the user's device and *they* hold it. PolyLM ships it to a
server and then to an LLM. **We send nothing.** Detection, anonymization, and restore run in
the browser via ONNX/WASM. The only network fetch is the model file, once, cached.

This is not a marketing gradient — it is a different architecture they cannot match without
rebuilding their product. Lead with it.

Sharpen the contrast:
- Them: *"Your data stays in the EU."*
- Us: *"Your data stays on your device. Nobody receives it — including us."*

### 2. Israeli-specific accuracy
Competitors do generic multi-language NER. They list "names, ID, phone, email, address" with
no determinism. We combine:
- **Deterministic** Israeli ID / phone / company / IBAN — regex + checksum (never guessed by a model).
- **Neural** Hebrew NER for names/orgs/places — `dictabert-ner`, tuned for Hebrew, not a
  general XLM model bolted onto 48 languages.

Result: higher precision/recall on Israeli documents than a one-size-fits-all engine. This is
measurable (recall check against `browser-poc/ner_testset.json`) — we can prove it, they can't
claim it.

### 3. Client-side round-trip restore
The killer workflow both competitors validated: anonymize → feed the LLM → restore real values
in the answer. anonym.legal does it, but the `token → original value` map lives in a
**server-side vault** — so the LLM doesn't see PII, but *anonym.legal does*. Our mapping lives
only in browser memory and dies when the tab closes. Same workflow, no third party ever holding
the originals.

## What we learned / what to adopt from them

These are their good ideas worth taking (client-side, of course):

1. **"Shield before the AI" framing.** Both converged on "sanitize before the LLM sees it."
   That is the highest-value use case and the clearest story. Adopt it as primary positioning.
2. **Restore is table stakes.** anonym.legal proved reversible round-trip is expected. Ship a
   solid tokenized restore — it is not optional.
3. **Reversible tokens with per-entity operators.** They expose modes (replace-with-type-token,
   mask, hash, encrypt, delete). We at minimum need consistent, reversible type tokens
   (`[NAME_1]`, `[ID_1]`) so the same entity maps to the same token across a document.
4. **Transparent, cheap pricing anchor.** They set the expectation that this is cheap/free.
   We are free + client-side — we win outright on price; say so plainly.
5. **Broad distribution surface.** They ship web + desktop + Chrome ext + Office add-in + MCP.
   We start Chrome-ext-first, but an **MCP server** (client-side privacy shield for Cursor/Claude)
   is the natural roadmap item — same promise, dev + legal audience.

## Gaps to close (where they currently beat us)

| Gap | Status | Priority |
|-----|--------|----------|
| Round-trip restore (reversible tokens) | planned | HIGH — table stakes |
| PDF + OCR | out of MVP (own hard spike) | MEDIUM — legal docs need it |
| MCP server (client-side shield) | roadmap | MEDIUM — validated use case |
| Office / Word integration | not planned | LOW |

## Target buyer

Israeli professionals bound by confidentiality who want to use AI tools safely:
lawyers (Bar ethics, privilege), healthcare, finance, HR. PolyLM proved they pay for Hebrew
AI tooling and care about PII. We are not their drafting suite — we are the trustworthy
anonymizer they run **before** pasting anything into ChatGPT/Claude/Gemini.

## Claims we can defend (and must never fake)

- "PII never leaves your device" — true by architecture; verifiable (no network calls but the
  model download). Per project constitution: real detection only, no server, no telemetry.
- "Israeli ID/phone/IBAN detected deterministically" — regex + checksum, provable.
- "The restore map lives only in your browser" — true; nothing persisted server-side.

Never claim accuracy numbers we haven't measured. Never claim a detection we don't actually do.
