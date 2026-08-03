# Trust & Verifiability — how we earn "we don't keep your data"

> Internal strategy. Our core claim ("PII never leaves the device") is only worth as much as the
> user's belief in it. This doc turns the claim from a **promise** into something a user — and
> especially a risk-averse Israeli lawyer — can **verify**. Positioning copy derived here lives in
> `marketing.md`; the architecture that makes it true lives in `differentiation.md`.

## The core principle

Move trust from **"trust the vendor"** to **"trust the browser you already trust."**
The user does not have to believe us. The browser (Chrome) enforces the boundary, and the user
can check it themselves. This is the exact opposite of the competitors, whose story is
"trust our server in Germany" (anonym.legal) or "trust our pipeline" (PolyLM).

## The trust ladder (weak → strong)

| Level | Mechanism | Who relies on it |
|-------|-----------|------------------|
| Promise | "We don't store your data" | anonym.legal, PolyLM |
| Certification | ISO 27001, GDPR audit | competitors |
| Transparency | open source | few |
| **Enforcement + self-verification** | browser physically blocks exfiltration; user checks it | **us** |

We aim for the bottom row. Everything above it we can also do — but the bottom row is the moat.

## Mechanisms, ranked by how convincing they are to a non-technical lawyer

### 1. Works offline — the most visceral proof
"Disconnect the internet. The tool still works. If it works with no network, it physically
cannot be sending anything." Understandable by anyone. Ship an in-app prompt: *"בדוק בעצמך —
כבה את החיבור לאינטרנט ונסה שוב."* Turns proof into an experience, not a claim.

### 2. The browser blocks us, not our own code (CSP)
Lock `connect-src` to only the model host; once the model is cached, effectively nothing.
Browser-**enforced**, headers are public and inspectable. The difference between "we promised not
to send" and "the browser won't let us send even if we wanted to." For the extension: publish it
with **zero host permissions / no network access** — Chrome itself then displays that the
extension cannot reach the network. Manifest is public; Chrome enforces it.

### 3. We ask for nothing
Zero signup, zero email, zero account, zero cookies, zero telemetry. You cannot leak what you
never collected. The restore **key downloads to the user's device** — *they* hold it, not us.
Asking-for-nothing is itself a strong trust signal, and it lands hard with lawyers ("you don't
even know who I am").

### 4. Open source + independent audit
Experts read the code and confirm there is no upload; their verification vouches for everyone
else. A published third-party security audit adds an institutional layer lawyers respect.

## The honest hard problem — and why the extension is our trust anchor

Open source does **not** prove the JS the browser just ran is the same code. A **web app can
silently change its JavaScript on any visit.** This is a real gap we must not paper over.

- **The extension is the trust anchor:** a signed package, downloaded once, that does not change
  per-visit; researchers audit the exact published version; Chrome enforces its declared (zero)
  network permissions. Someone who wants maximum certainty installs the extension.
- **The web app is reach:** zero-friction front door, but it must mitigate the deploy-gap with
  Subresource Integrity (SRI) and a **published build hash** users/experts can compare.

This re-justifies shipping both surfaces (see the web-first decision in `CLAUDE.md`): the web app
converts, the extension is the "prove it to me" version. For lawyers, that framing is the sell —
*"want certainty? install the extension Chrome confirms cannot touch the network."*

## Why lawyers specifically need proof, not promises

An Israeli lawyer's **license is on the line** (confidentiality/privilege duties under כללי לשכת
עורכי הדין (אתיקה מקצועית) תשמ"ו-1986 + חוק לשכת עורכי הדין; and "data controller" duties under
תיקון 13 to the Privacy Protection Law, in force 14 Aug 2025, with fines up to ~₪3.2M). A
risk-averse professional does not act on a marketing promise — he acts on something he can check.
"Disconnect the network and see" is built for exactly this person. (Legal specifics: verify via
`israeli-law-fetcher` before any campaign — we never invent a statute or a number.)

## What to build (mapped to tasks)

| Priority | Item | Task |
|----------|------|------|
| HIGH | "Zero network" live badge + "test offline" prompt | P2W-04 (extend) |
| HIGH | Strict CSP `connect-src` locked to model host, publicly documented | TR-01 |
| HIGH | Extension published with zero network/host permissions; surface it in UI | TR-02 |
| HIGH | Zero signup/account/cookies/telemetry — hard rule, stated as a trust argument | TR-03 |
| MED | "How to verify us yourself" page (DevTools + offline test) | P5-01 (extend) |
| MED | Open-source the engine + web app; SRI + published build hash for the web deploy | TR-04 |
| LATER | Independent third-party security audit, report published | TR-05 |

## The one-line story

**"אל תאמין לנו. נתק את הרשת ותראה." — "Don't trust us. Disconnect the internet and watch."**
