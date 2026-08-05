# Mechikon (מחיקון) — UX Flow & Hebrew Copy Spec (P2W)

> Source copy for the web app UI. Hebrew is the only launch language; every string ships through
> i18next keys (P0I-05) — nothing here is hardcoded. Design identity: professional/legal, navy/slate
> semantic tokens (P2W-05). RTL throughout. Strings below are canonical; §6 is the consolidated key
> table. (Produced by a focused UX+copy pass, 2026-08-04; grounded in marketing.md, trust.md,
> differentiation.md, tasks.md.)

## 0. Voice & copy conventions (binding)

- **Register:** professional-direct Hebrew ("business" register). Not legalese, not startup-casual. A
  lawyer should feel this was written by someone who understands חיסיון, not by a translation engine.
- **Vocabulary:** say **השחרה** (not "אנונימיזציה" in UI), **פרטים מזהים** (not "PII"), **חיסיון/סודיות**
  when addressing the lawyer's fear. "אנונימיזציה" may appear once in parentheses on the landing page
  for SEO.
- **Gender neutrality:** buttons/short actions use **action nouns** (העתקה, הורדה, השחרה, שחזור, ביטול) —
  the Gmail-Hebrew convention, neutral and professional. Instructional sentences use **plural
  imperative** (הדביקו, בחרו, ודאו). Descriptive text uses neutral constructions (ניתן ל…, יש ל…). Never
  mix masculine-singular imperatives into UI chrome.
- **Typography:** ktiv maleh throughout; Hebrew gershayim **U+05F4 (״)** in abbreviations (ת״ז, ח״פ,
  דוא״ל) — matches the locked placeholder alphabet `[ת״ז_1]` (P1-13), so UI and placeholders read
  identically. Maqaf **U+05BE (־)** before Latin/numbers: ל־AI, כ־185 MB. Numerals stay LTR inside RTL
  text (wrap with `dir="ltr"` spans where needed).
- **Honesty rule (constitution):** never promise perfection, never claim legal compliance as an
  outcome, never soften the OCR refusal. "Real detection only" applies to copy too.
- **Trust placement rule (P2W-05 DoD):** the trust surface is prominent in the header/hero — never
  footer-only.

---

## 1. Screen / flow map (text wireframes, RTL)

State machine: `S0 Landing → S1 Input → (S1a Model download) → S2 Detecting → S3 Review → S4 Output →
S5 Round-trip restore`. Error/refusal states: `E1 local error`, `E2 OCR refusal`, `E3 model-integrity
failure`. Trust surface is persistent chrome, not a state.

### S0 — Landing / hero (same page as the tool; hero above the input — no separate marketing gate)

```
┌────────────────────────────────────────────────────────────── RTL ──┐
│ [BAI Solutions ↗]                    מחיקון      [● 0 בקשות רשת ▾] │  ← header: logo right, trust badge left
│                                                                     │
│           משחירים לפני שמדביקים ל־AI. החיסיון נשאר אצלכם.           │  ← hero.title
│   מחיקון מזהה ומשחיר פרטים מזהים במסמכים בעברית — שמות, ת״ז,        │
│   טלפונים, מספרי תיק — והכול קורה בדפדפן שלכם בלבד. שום דבר          │
│   לא נשלח לשום שרת. אף אחד לא רואה את המסמך — גם לא אנחנו.          │  ← hero.subtitle
│                                                                     │
│        [ להתחיל — בלי הרשמה ]        אל תאמינו לנו — בדקו בעצמכם ▾  │  ← CTA + trust.verifyLink
│   ┌──────── איך זה עובד ────────┐                                   │
│   │ 1 השחרה  2 הדבקה ב־AI  3 החזרת התשובה  4 שחזור  │              │  ← 4-step strip (see §2)
└─────────────────────────────────────────────────────────────────────┘
```

Transitions: CTA scrolls to S1 (same page). Trust badge opens the verification popover (§3). No modal,
no signup, no cookie banner (there are no cookies — TR-03; the *absence* of a cookie banner is on-brand).

### S1 — Input

```
│  ┌─ tabs (RTL, right-first) ──────────────────────────┐
│  │ [ הדבקת טקסט ]  [ העלאת קובץ ]                     │
│  │ Tab 1 textarea placeholder:                        │
│  │   "הדביקו כאן טקסט — חוזה, כתב טענות, מכתב…        │
│  │    הטקסט לא יישלח לשום מקום."                      │
│  │ Tab 2 dropzone:                                    │
│  │   "גרירת קובץ לכאן או בחירה מהמחשב"                │
│  │   "DOCX · XLSX · PDF (כולל מסמכים סרוקים)"         │
│  │            [ השחרת המסמך ]  (primary, ≥44px)       │
│  └────────────────────────────────────────────────────┘
```

- Empty state IS the input — no separate empty screen.
- If the engine isn't cached, pressing השחרה enters **S1a**; typing/pasting allowed during download.
- Scanned PDF detected → scan-mode caveat inline (§4) before processing.
- Input that already contains placeholder-looking tokens → warn (`input.looksAnonymized`, P1-15) and
  offer to jump to S5 instead.

### S1a — First-time model download (one-time, ~185 MB; P4-02/P0I-03)

Progress panel, not a blocking modal (input stays usable):
- Title: **הורדה חד־פעמית של מנוע הזיהוי**
- Body: **מנוע הזיהוי בעברית (כ־185 MB) נטען עכשיו אל הדפדפן ויישמר בו. זה קורה פעם אחת — מהביקור הבא
  הכלי ייטען מיד, וגם בלי אינטרנט.**
- Trust line: **שימו לב לכיוון: המנוע יורד אל המסמך. המסמך לא עולה לשום מקום.**
- PDF/scan first use lazily adds mupdf/tesseract (P0I-02): **טוענים רכיב לעיבוד PDF/סריקה (חד־פעמי)…**
- Hash-mismatch (P0I-04) → **E3**: refuse to run (§6 `error.modelIntegrity`).

### S2 — Detecting

Inline progress over the input: **מזהים פרטים… הכול קורה במחשב שלכם.** Long PDFs get a page counter:
**עמוד 3 מתוך 12…** UI thread stays responsive (P0I-01) — copy never says "רק רגע" without a live signal.

### S3 — Review (detection results)

```
│ ┌─ summary bar ─────────────────────────────────────────────┐
│ │ נמצאו 14 פרטים מזהים:  שם ×4 · ת״ז ×2 · טלפון ×3 · …      │  ← per-type count chips
│ │ [סינון לפי סוג ▾]                    [ המשך להשחרה ]      │
│ └───────────────────────────────────────────────────────────┘
│ Document body with highlights (semantic per-type colors).
│ Click a highlight → popover: type · value · confidence · [השארה גלויה][סגירה]
│ Kept words: dashed underline + chip "נשאר גלוי" + undo [החזרה להשחרה].
│ Per-type toggles in the filter menu.
│ Zero results: honest, not celebratory (review.summary.zero).
```

Deterministic detections say **זוהה בוודאות (ספרת ביקורת)**; NER detections say **זוהה על ידי מנוע
השפה** — pillar 2 made visible.

### S4 — Output (anonymized result + key panel)

Anonymized text with inline placeholders (`[שם_1]`, `[ת״ז_1]`); [העתקת הטקסט המושחר] / [הורדת קובץ];
legend line; restore-key panel (KEY-01, §5); "next step" card → S5. Copy fires `toast.copiedAnon`.
`beforeunload` guard when an un-downloaded key exists (`key.leaveWarning`).

### S5 — Round-trip restore ("before the AI" — P2W-03, §2)

Two-pane stepper: paste the AI's answer; restore via in-memory key (same tab) or uploaded key file.
States: in-memory → restore; no key → upload (`restore.uploadKey`); encrypted → passphrase; docId
mismatch → warning (`restore.keyMismatch`); unmatched placeholders → explicit report (`restore.partial`,
never silent).

### E1 — Local error (P0I-07)
Friendly local-only panel, opt-in copy-report. Never auto-sends.

### E2 — OCR refusal (OCR-03)
Hard stop for low-confidence scans (§4). Blocks output; offers alternatives. Never silent partial.

---

## 2. The killer "before the AI" flow — exact steps + microcopy

One horizontal 4-step strip (RTL: step 1 rightmost), shown twice — static explainer on the hero, and a
**live stepper** that tracks S1→S4→S5. Same numbers/icons/words in both — the marketing explainer *is*
the product navigation, so there is nothing new to learn.

```
  ④ שחזור ←——— ③ הדבקת התשובה ←——— ② עבודה ב־AI ←——— ① השחרה
```

| Step | Title | Body |
|---|---|---|
| 1 | **משחירים כאן** | מדביקים או מעלים את המסמך. כל פרט מזהה מוחלף בסימון: ״ישראל ישראלי״ הופך ל־[שם_1]. |
| 2 | **עובדים עם ה־AI** | מעתיקים את הטקסט המושחר ומדביקים אותו ב־ChatGPT, ב־Claude או בכל כלי אחר. ה־AI רואה [שם_1] — לא את הלקוח. |
| 3 | **מחזירים את התשובה** | מדביקים כאן את התשובה שהתקבלה מה־AI, כשהסימונים עדיין בתוכה. |
| 4 | **מקבלים חזרה את המקור** | מחיקון מחזיר את הערכים האמיתיים לתוך התשובה — בדפדפן שלכם בלבד. ה־AI מעולם לא ידע מי הלקוח. |

Supporting microcopy: `flow.safeToPaste` above the step-2 copy button; `restore.pastePlaceholder` on
step 3; `restore.doneBanner` on step 4; `flow.demoLink` — a 30-second synthetic canned demo of the whole
loop (teaches the loop without risking a real document). Stepper is persistent; step 2 rendered as an
*external* step (outlined, ↗ icons) to make "this part happens outside, and that's the point" explicit;
≥44px targets, clickable back.

---

## 3. Trust surface — where the proof lives (per docs/trust.md)

**(a) Header badge — persistent, every state (P2W-04).** Live pill (left in RTL): `● 0 בקשות רשת` —
green dot, reflecting *real* observed state (during download truthfully reads
`● מוריד מנוע — ההורדה היחידה שיש`). Click → verification popover:
> **בדקו אותנו — אל תאמינו לנו.** (`trust.popover.title`)
> מאז שהמנוע נטען, הדף הזה לא שלח ולא קיבל שום בקשת רשת. אפשר לוודא בשתי דרכים: (`trust.popover.body`)
> **1. נתקו את האינטרנט.** כבו Wi-Fi — והשחירו מסמך. הכלי ימשיך לעבוד, כי הכול רץ אצלכם. מה שעובד בלי
> רשת, פיזית לא יכול לשלוח כלום. (`trust.popover.offline`)
> **2. פתחו את כלי הפיתוח.** F12 ← לשונית Network. חוץ מהורדת המנוע החד־פעמית — הרשימה ריקה.
> (`trust.popover.devtools`)
> **המדריך המלא לאימות עצמי ←** (`trust.popover.guideLink` → verification page, P5-01)

**(b) Hero trust strip — three short claims (`trust.strip.*`):** no-signup/cookies · works offline ·
open source (see §6 for full strings).

**(c) "Maximum certainty" card (extension cross-sell, TR-02/P5-05):** `trust.extensionCard` +
`trust.extensionCta`.

Footer/meta tagline (`trust.tagline`): **פרטיות לפי ארכיטקטורה, לא לפי הבטחה.**

**Rule:** the badge and offline claim are **rendered from real state** — if any network request other
than the model fetch ever occurs, the badge must show it. A trust surface that lies once is dead forever
with this audience.

---

## 4. Scanned-PDF honesty + the REFUSAL (OCR-03 — hard requirement)

**Scan-mode caveat** (shown when a scanned PDF is detected, before processing — `ocr.caveat.*`):
> **זוהה מסמך סרוק — ההשחרה תתבסס על זיהוי תווים (OCR).**
> זיהוי בסריקה אינו ודאי כמו במסמך טקסט: איכות הסריקה קובעת את איכות הזיהוי. מחיקון יציג את רמת הביטחון,
> ואם היא נמוכה מדי — יעצור ולא יפיק תוצאה חלקית. גם בסריקה טובה, עברו על התוצאה לפני שהיא יוצאת מכם.
> [ המשך בעיבוד הסריקה ]

**Per-page confidence** (`ocr.confidence.*`): גבוהה / בינונית (adds "מומלץ לעבור על עמוד זה בעיון").

**The refusal** (below the OCR-01 threshold — **blocks output, no override button**):
> **לא ניתן להשחיר את הסריקה הזו באופן אמין** (`ocr.refusal.title`)
> איכות הסריקה נמוכה מכדי שנוכל לקרוא אותה ברמת ביטחון מספקת. השחרה על סמך זיהוי חלקי עלולה להשאיר שם או
> מספר זהות גלויים בלי שאיש ישים לב — ולכן אנחנו עוצרים כאן, ולא מפיקים תוצאה חלקית. (`ocr.refusal.body`)
> **מה אפשר לעשות:** re-scan 300 DPI · upload the text-source · type the sensitive part as text
> (`ocr.refusal.option1..3`)
> שקיפות מלאה: עדיף לומר ״לא הצלחנו״ מאשר להחזיר מסמך שנראה מושחר — ואינו. (`ocr.refusal.honesty`)

Full-width warning panel in the document area (not a dismissible toast); the three options are real
actions. **No "המשך בכל זאת"** — a partial redaction that looks complete is the one output this product
must never produce (PDF-05a proved a noisy scan silently missed a name).

---

## 5. Restore-key UX (KEY-01)

**Default — in-memory, framed as the feature (`key.default.*`):** the key lives only in this tab and is
erased on close; other tools keep it on their server, we have no server that could. Download a copy only
if you want later/cross-device restore — it is the only copy and only you hold it.

**Opt-in download:** `key.download.cta`; checkbox **checked by default** `key.encrypt.checkbox` +
`key.encrypt.helper`.

**Passphrase prompt** (`key.passphrase.*`): choose+confirm; warning that encryption is local and a lost
passphrase is unrecoverable (and with it the key).

**Unencrypted-download confirm** (`key.plainConfirm`): friction on the unsafe path.

**Post-download toast** (`toast.keySaved`), **tab-close guard** (`key.leaveWarning`), restore-side
prompts (`restore.*`). Cross-surface framing (`key.vaultFraming`): *כספת השחזור היא קובץ שרק אתם מחזיקים
— מוצפן, ומעולם לא עבר אצל איש.*

---

## 6. Microcopy set — i18next keys (Hebrew values, canonical)

```yaml
# --- app / brand ---
app.name: "מחיקון"
app.byline: "כלי חינמי מבית BAI Solutions"
app.tagline: "המידע לא עוזב את המכשיר."

# --- hero ---
hero.title: "משחירים לפני שמדביקים ל־AI. החיסיון נשאר אצלכם."
hero.subtitle: "מחיקון מזהה ומשחיר פרטים מזהים במסמכים בעברית — שמות, ת״ז, טלפונים, מספרי תיק — והכול קורה בדפדפן שלכם בלבד. שום דבר לא נשלח לשום שרת. אף אחד לא רואה את המסמך — גם לא אנחנו."
hero.cta: "להתחיל — בלי הרשמה"
hero.altTitle: "השחרה (אנונימיזציה) של מסמכים בעברית — כולה בדפדפן"   # SEO/alt variant

# --- flow (the 4-step loop) ---
flow.step1.title: "משחירים כאן"
flow.step1.body: "מדביקים או מעלים את המסמך. כל פרט מזהה מוחלף בסימון: ״ישראל ישראלי״ הופך ל־[שם_1]."
flow.step2.title: "עובדים עם ה־AI"
flow.step2.body: "מעתיקים את הטקסט המושחר ומדביקים אותו ב־ChatGPT, ב־Claude או בכל כלי אחר. ה־AI רואה [שם_1] — לא את הלקוח."
flow.step3.title: "מחזירים את התשובה"
flow.step3.body: "מדביקים כאן את התשובה שהתקבלה מה־AI, כשהסימונים עדיין בתוכה."
flow.step4.title: "מקבלים חזרה את המקור"
flow.step4.body: "מחיקון מחזיר את הערכים האמיתיים לתוך התשובה — בדפדפן שלכם בלבד. ה־AI מעולם לא ידע מי הלקוח."
flow.safeToPaste: "הטקסט הזה נקי מפרטים מזהים — בטוח להדבקה בכל כלי AI."
flow.demoLink: "צפייה בדוגמה (30 שניות, בלי מסמך אמיתי)"

# --- input ---
input.tab.paste: "הדבקת טקסט"
input.tab.upload: "העלאת קובץ"
input.paste.placeholder: "הדביקו כאן טקסט — חוזה, כתב טענות, מכתב… הטקסט לא יישלח לשום מקום."
input.upload.dropzone: "גרירת קובץ לכאן או בחירה מהמחשב"
input.upload.formats: "DOCX · XLSX · PDF (כולל מסמכים סרוקים)"
input.upload.invalidFormat: "סוג הקובץ אינו נתמך. ניתן להעלות DOCX, XLSX או PDF."
input.submit: "השחרת המסמך"
input.looksAnonymized: "נראה שהטקסט כבר מכיל סימוני השחרה. אולי התכוונתם לשחזר תשובה מה־AI?"
input.looksAnonymized.cta: "מעבר לשחזור"

# --- loader / model ---
loader.firstTime.title: "הורדה חד־פעמית של מנוע הזיהוי"
loader.firstTime.body: "מנוע הזיהוי בעברית (כ־185 MB) נטען עכשיו אל הדפדפן ויישמר בו. זה קורה פעם אחת — מהביקור הבא הכלי ייטען מיד, וגם בלי אינטרנט."
loader.firstTime.direction: "שימו לב לכיוון: המנוע יורד אל המסמך. המסמך לא עולה לשום מקום."
loader.progress: "הורדה: {{percent}}%"
loader.pdfComponent: "טוענים רכיב לעיבוד PDF (חד־פעמי)…"
loader.ocrComponent: "טוענים רכיב לזיהוי סריקות (חד־פעמי, כ־21 MB)…"
loader.detecting: "מזהים פרטים… הכול קורה במחשב שלכם."
loader.detectingPage: "עמוד {{current}} מתוך {{total}}…"

# --- entity types (map 1:1 to EntityType in engine/src/types.ts) ---
entity.name: "שם"
entity.org: "ארגון"
entity.place: "מקום"
entity.id: "ת״ז"
entity.phone: "טלפון"
entity.company: "ח״פ"
entity.iban: "חשבון בנק (IBAN)"
entity.case: "מספר תיק"
entity.land: "גוש/חלקה"
entity.policy: "מספר פוליסה"
entity.insured: "מספר מבוטח"
entity.email: "אימייל"

# --- review (S3) ---
review.summary: "נמצאו {{count}} פרטים מזהים"
review.summary.zero: "לא זוהו פרטים מזהים. שימו לב: אף מנגנון זיהוי אינו מושלם — מומלץ לעבור על הטקסט לפני שיתוף."
review.filterByType: "סינון לפי סוג"
review.toggleType: "השחרת כל הפריטים מסוג {{type}}"
review.detectedDeterministic: "זוהה בוודאות (ספרת ביקורת)"
review.detectedNer: "זוהה על ידי מנוע השפה"
review.keepVisible: "השארה גלויה"
review.keptChip: "נשאר גלוי"
review.undoKeep: "החזרה להשחרה"
review.continue: "המשך להשחרה"
review.checkBeforeSend: "עברו על הסימונים — ההחלטה הסופית תמיד אצלכם."

# --- output (S4) ---
output.copyAnon: "העתקת הטקסט המושחר"
output.downloadFile: "הורדת הקובץ המושחר"
output.legend: "כל מופע של אותו ערך מקבל תמיד את אותו סימון — [שם_1] הוא תמיד אותו אדם."
output.nextStep: "עכשיו אפשר להדביק את הטקסט ב־ChatGPT, ב־Claude או בכל כלי AI — בלי לחשוף את הלקוח. כשמתקבלת תשובה, חוזרים לכאן לשחזור."
output.gotoRestore: "מעבר לשחזור"

# --- restore key (KEY-01) ---
key.default.title: "מפתח השחזור שמור בזיכרון הכרטיסייה — ולא בשום מקום אחר."
key.default.body: "המפתח — המיפוי בין כל סימון לערך המקורי — קיים רק כאן, בכרטיסייה הזו. כשסוגרים אותה, הוא נמחק סופית. אצל כלים אחרים המפתח הזה שמור אצלם בשרת; אצלנו אין שרת שיכול לשמור אותו."
key.default.downloadHint: "אם תרצו לשחזר גם מאוחר יותר או במחשב אחר — הורידו עותק. זה הקובץ היחיד שקיים, ורק אתם מחזיקים בו."
key.download.cta: "הורדת מפתח שחזור (לא חובה)"
key.encrypt.checkbox: "הצפנת המפתח בסיסמה (מומלץ)"
key.encrypt.helper: "קובץ מוצפן אינו ניתן לקריאה בלי הסיסמה — גם אם יישלח בטעות במייל או יישמר בענן."
key.passphrase.title: "בחרו סיסמה להצפנת המפתח"
key.passphrase.field: "סיסמה"
key.passphrase.confirmField: "אימות סיסמה"
key.passphrase.mismatch: "הסיסמאות אינן זהות."
key.passphrase.warning: "חשוב: ההצפנה מתבצעת במחשב שלכם והסיסמה אינה נשמרת בשום מקום. סיסמה שאבדה — אין דרך לשחזר, ואיתה יאבד גם המפתח."
key.passphrase.submit: "הצפנה והורדה"
key.plainConfirm: "המפתח יישמר כקובץ קריא. מי שמחזיק בו יוכל לשחזר את כל הפרטים שהושחרו. לשמור בכל זאת ללא הצפנה?"
key.plainConfirm.yes: "שמירה ללא הצפנה"
key.plainConfirm.no: "חזרה"
key.leaveWarning: "שימו לב: סגירת הכרטיסייה תמחק את מפתח השחזור לצמיתות. בלי המפתח לא ניתן יהיה להחזיר את הערכים המקוריים לתשובת ה־AI. להוריד עותק לפני היציאה?"
key.vaultFraming: "כספת השחזור היא קובץ שרק אתם מחזיקים — מוצפן, ומעולם לא עבר אצל איש."

# --- restore (S5) ---
restore.title: "שחזור הערכים המקוריים"
restore.pastePlaceholder: "הדביקו כאן את תשובת ה־AI — כולל הסימונים ([שם_1], [ת״ז_1]…)"
restore.submit: "שחזור הערכים המקוריים"
restore.uploadKey: "אין מפתח שחזור בכרטיסייה זו. העלו את קובץ המפתח שהורדתם."
restore.uploadKey.cta: "העלאת קובץ מפתח"
restore.decrypt.title: "הקובץ מוצפן — הזינו את הסיסמה שבחרתם"
restore.decrypt.submit: "פענוח"
restore.decrypt.wrong: "הסיסמה שגויה. הפענוח מתבצע במחשב שלכם בלבד — נסו שוב."
restore.keyMismatch: "המפתח שהועלה נוצר עבור מסמך אחר. אפשר להמשיך, אך ייתכן שחלק מהסימונים לא ישוחזרו."
restore.keyMismatch.continue: "המשך בכל זאת"
restore.doneBanner: "הערכים המקוריים הוחזרו. גם הפעולה הזו קרתה כולה במחשב שלכם."
restore.partial.title: "{{count}} סימונים לא נמצאו במפתח ונותרו כפי שהם:"
restore.partial.hint: "ייתכן שכלי ה־AI שינה סימון (למשל הוסיף רווח או גרשיים). אפשר לתקן ידנית בטקסט ולנסות שוב."
restore.copyResult: "העתקת הטקסט המשוחזר"

# --- trust surface ---
trust.badge.zero: "0 בקשות רשת"
trust.badge.downloading: "מוריד מנוע — ההורדה היחידה שיש"
trust.popover.title: "בדקו אותנו — אל תאמינו לנו."
trust.popover.body: "מאז שהמנוע נטען, הדף הזה לא שלח ולא קיבל שום בקשת רשת. אפשר לוודא בשתי דרכים:"
trust.popover.offline: "נתקו את האינטרנט. כבו Wi-Fi — והשחירו מסמך. הכלי ימשיך לעבוד, כי הכול רץ אצלכם. מה שעובד בלי רשת, פיזית לא יכול לשלוח כלום."
trust.popover.devtools: "פתחו את כלי הפיתוח: F12 ← לשונית Network. חוץ מהורדת המנוע החד־פעמית — הרשימה ריקה."
trust.popover.guideLink: "המדריך המלא לאימות עצמי"
trust.strip.noSignup: "בלי הרשמה. בלי חשבון. בלי עוגיות. אי אפשר להדליף מידע שמעולם לא נאסף."
trust.strip.offline: "עובד גם בלי אינטרנט. נתקו את הרשת ותראו בעצמכם."
trust.strip.openSource: "קוד פתוח. כל אחד יכול לקרוא ולוודא: שום דבר לא נשלח."
trust.extensionCard: "רוצים ודאות מוחלטת? התקינו את התוסף לכרום. התוסף מוגדר ללא כל הרשאת רשת — כרום עצמו מאשר שהוא אינו יכול לתקשר עם שום שרת."
trust.extensionCta: "התקנת התוסף לכרום"
trust.tagline: "פרטיות לפי ארכיטקטורה, לא לפי הבטחה."

# --- OCR / scans ---
ocr.caveat.title: "זוהה מסמך סרוק — ההשחרה תתבסס על זיהוי תווים (OCR)"
ocr.caveat.body: "זיהוי בסריקה אינו ודאי כמו במסמך טקסט: איכות הסריקה קובעת את איכות הזיהוי. מחיקון יציג את רמת הביטחון, ואם היא נמוכה מדי — יעצור ולא יפיק תוצאה חלקית. גם בסריקה טובה, עברו על התוצאה לפני שהיא יוצאת מכם."
ocr.caveat.cta: "המשך בעיבוד הסריקה"
ocr.confidence.high: "רמת ביטחון בזיהוי: גבוהה"
ocr.confidence.medium: "רמת ביטחון בזיהוי: בינונית — מומלץ לעבור על עמוד זה בעיון"
ocr.refusal.title: "לא ניתן להשחיר את הסריקה הזו באופן אמין"
ocr.refusal.body: "איכות הסריקה נמוכה מכדי שנוכל לקרוא אותה ברמת ביטחון מספקת. השחרה על סמך זיהוי חלקי עלולה להשאיר שם או מספר זהות גלויים בלי שאיש ישים לב — ולכן אנחנו עוצרים כאן, ולא מפיקים תוצאה חלקית."
ocr.refusal.optionsTitle: "מה אפשר לעשות:"
ocr.refusal.option1: "לסרוק מחדש באיכות גבוהה יותר (מומלץ 300 DPI, ישר וללא הצללות)"
ocr.refusal.option2: "אם קיים מסמך המקור — להעלות אותו כקובץ Word או PDF טקסטואלי"
ocr.refusal.option3: "להקליד את הקטע הרגיש ולהשחיר אותו כטקסט"
ocr.refusal.honesty: "שקיפות מלאה: עדיף לומר ״לא הצלחנו״ מאשר להחזיר מסמך שנראה מושחר — ואינו."

# --- toasts ---
toast.copiedAnon: "הטקסט המושחר הועתק. אפשר להדביק אותו בכל כלי AI."
toast.copiedRestored: "הטקסט המשוחזר הועתק."
toast.anonymized: "המסמך הושחר — {{count}} פרטים מזהים הוחלפו בסימונים."
toast.restored: "השחזור הושלם — {{count}} ערכים הוחזרו למקומם."
toast.keySaved: "המפתח נשמר אצלכם. הוא לא עבר דרך שום שרת — כי אין כזה."
toast.fileDownloaded: "הקובץ המושחר ירד למחשב שלכם."

# --- errors (P0I-07: local only, opt-in report) ---
error.generic.title: "משהו השתבש"
error.generic.body: "אירעה שגיאה מקומית. שום מידע לא נשלח לשום מקום — גם לא דוח השגיאה. אם תרצו לעזור לנו לתקן, אפשר להעתיק דוח שגיאה טכני (ללא תוכן המסמך) ולשלוח אלינו במייל. זה תמיד לבחירתכם."
error.copyReport: "העתקת דוח שגיאה"
error.reportCopied: "דוח השגיאה הועתק. הוא אינו כולל את תוכן המסמך."
error.retry: "ניסיון חוזר"
error.modelIntegrity: "אימות תקינות מנוע הזיהוי נכשל, ולכן מחיקון לא יופעל. נסו לרענן את הדף; אם הבעיה חוזרת — ייתכן שאירעה תקלה ברשת שממנה ירד המנוע. לא נריץ מנוע שלא אומת."
error.offlineFirstLoad: "נדרש חיבור לאינטרנט פעם אחת בלבד — להורדת מנוע הזיהוי. לאחר מכן הכלי עובד גם בלי רשת."
error.fileTooLarge: "הקובץ גדול מדי לעיבוד בדפדפן ({{max}} לכל היותר). נסו לפצל את המסמך."
error.fileParse: "לא הצלחנו לקרוא את הקובץ. ודאו שאינו פגום או מוגן בסיסמה."

# --- footer / legal ---
legal.notAdvice: "מחיקון הוא כלי טכני לסיוע בהשחרת מידע, ואינו מהווה ייעוץ משפטי או תחליף לשיקול דעת מקצועי."
legal.reviewDuty: "אף מנגנון זיהוי אינו מושלם. האחריות לבדוק את התוצאה לפני העברתה לכל גורם — עליכם."
legal.noCollection: "איננו אוספים מידע. אין חשבון, אין עוגיות, אין אנליטיקות, אין טלמטריה. המסמכים אינם מגיעים אלינו — טכנית אין לאן."
legal.openSource: "הקוד פתוח וזמין לעיון — כך שכל אחד יכול לוודא ששום דבר אינו נשלח."
legal.landingFraming: "כלי עזר לשמירה על סודיות וחיסיון — ההחלטה המקצועית נשארת שלכם."
legal.brand: "מחיקון — כלי חינמי מבית BAI Solutions."
legal.privacyLink: "הצהרת פרטיות"
legal.confidentialityNote: "נבנה עבור מי שמחויבים בסודיות מקצועית — עורכי דין, רואי חשבון, רופאים ויועצים."
```

Notes:
- `{{count}}`/`{{percent}}` are i18next interpolations; add `_plural` forms where Hebrew needs them
  (`review.summary` → "נמצא פריט מזהה אחד" for count=1).
- Entity keys map 1:1 to `EntityType` in `engine/src/types.ts`; placeholder labels inside `[…_n]` come
  from the engine (P1-13), the UI labels above from i18n — both use U+05F4.
- English (`en`) is a later fill-in; keys are final now so the swap is copy-only.

---

## 7. Legal / disclaimer rules (lawyer audience + BAI brand)

1. **Never claim compliance as an outcome.** Amendment-13 / Bar-ethics appear as *context* on the
   landing "why" section (per marketing.md), never as "שימוש במחיקון עומד בדרישות החוק". Strongest
   permitted UI framing: `legal.landingFraming`. Any statute/section/fine number must be re-verified via
   `israeli-law-fetcher` before publishing — never copy numbers into UI strings.
2. **The honesty disclaimer is not small print.** `legal.reviewDuty` / `review.checkBeforeSend` appear
   at the point of action (S3) and in the footer — states its limits; protects BAI.
3. **`legal.noCollection` doubles as the privacy-policy summary** (P5-01): the hosted page opens with it
   verbatim, then the technical explanation (CSP, no cookies, model-download-only). One source of truth.
4. **Brand line** `legal.brand` sits in the footer linking bai-solutions — quiet BAI credibility;
   Mechikon is the product, BAI is the maker.

---

## 8. Top 5 UX risks for this audience + mitigations

1. **Disbelief ("this obviously uploads my document").** Default assumption is that the claim is false →
   the user leaves. *Mitigation:* trust surface in the chrome not footer (§3); live network badge; the
   offline self-test as an imperative experience; the extension card for maximum-certainty; no
   signup/cookie banner as ambient proof.
2. **Over-trust → a missed name reaches ChatGPT → privilege breach blamed on us.** *Mitigation:*
   mandatory review state (S3); deterministic-vs-NER honesty labels; `review.checkBeforeSend`; zero-
   results warns not celebrates; OCR refusal (no override); TR-06 "we publish our misses".
3. **Restore key silently lost.** In-memory default violates the "files persist" mental model.
   *Mitigation:* key panel explains in-memory as a benefit *and* states the death condition;
   `beforeunload` + `key.leaveWarning`; S4 next-step mentions *this tab*; encrypted download one click,
   pre-checked (safe path = lazy path).
4. **First-visit 185 MB feels broken/suspicious on office networks.** *Mitigation:* named, sized,
   framed one-time; the direction line kills the upload misread; input usable during download; Service
   Worker makes visit 2 instant + offline.
5. **The round-trip is a novel mental model ("paste the answer *back*?").** *Mitigation:* the 4-step
   strip is both explainer and live navigation (learned once); step 2 visually external; the 30-second
   synthetic demo; `flow.safeToPaste`; tolerant restore + `restore.partial` (loud, not silent).

---

**Handoff for P2W:** entity keys must match `EntityType` (P1-01); `review.*` implements P2-04 keep-word
rescue on the web surface; `trust.badge.*` is P2W-04's DoD; `ocr.refusal.*` satisfies OCR-03's "wording
reviewed"; `key.*` implements KEY-01 (in-memory default, opt-in download, encryption checkbox checked).
