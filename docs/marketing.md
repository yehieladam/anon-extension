# Marketing & Messaging

> Copy and messaging for the product. Hebrew is primary (the shipped audience is Israeli);
> English follows for the future web app / international. Strategy behind this lives in
> `differentiation.md`. All shipped UI text goes through the i18n layer — this file is the
> source copy, not hardcoded strings.

---

## Positioning (one line)

**עברית:** המנתב שאף פעם לא שולח — כלי ההשחרה (אנונימיזציה) העברי היחיד שרץ לגמרי בדפדפן.
המידע האישי לא יוצא מהמכשיר שלך. אף אחד לא רואה אותו — גם לא אנחנו.

**English:** The Hebrew PII anonymizer that never sends your data anywhere. Detect, anonymize,
use with any AI, and restore — all inside your browser. Nobody sees your PII. Not even us.

---

## The core promise (the wedge)

עברית:
> כל כלי אחר שולח את הטקסט שלך לשרת — בגרמניה, בארה"ב, לא משנה. אנחנו לא שולחים כלום.
> הזיהוי, ההשחרה והשחזור קורים בדפדפן שלך בלבד. המידע האישי לא עוזב את המכשיר.

English:
> Every other tool sends your text to a server — Germany, the US, doesn't matter. We send
> nothing. Detection, anonymization, and restore happen only in your browser. Your PII never
> leaves the device.

---

## The killer use case: "המגן שלפני ה-AI"

עברית:
> רוצה להשתמש ב-ChatGPT / Claude / Gemini על מסמך רגיש? הדבק אותו אצלנו קודם.
> אנחנו משחירים את כל המידע האישי, אתה שולח ל-AI טקסט מעוקר, ואז מחזירים את הערכים
> המקוריים לתוך התשובה — הכל בדפדפן. ה-AI אף פעם לא רואה מי הלקוח שלך. וגם אנחנו לא.

English:
> Want to use ChatGPT / Claude / Gemini on a sensitive document? Paste it here first. We strip
> every piece of PII, you send the sanitized text to the AI, then we restore the real values
> back into the answer — all in the browser. The AI never learns who your client is. Neither do we.

---

## Messaging pillars

### 1. אף אחד לא רואה — גם לא אנחנו / Nobody sees it, not even us
- עברית: אפס שרת. אפס חשבון. אפס טלמטריה. המידע חי בדפדפן ומת כשסוגרים את הכרטיסייה.
- English: Zero server. Zero account. Zero telemetry. Data lives in the tab and dies when you close it.
- Contrast: competitors promise "your data stays in the EU." We promise "your data stays on your device."

### 2. מדויק לישראל / Built for Israeli data
- עברית: ת"ז, טלפון, ח.פ., IBAN — מזוהים בוודאות (בדיקת ספרת ביקורת, לא ניחוש). שמות וארגונים —
  מודל NER עברי אמיתי (dictabert), לא מנוע גנרי ל-48 שפות.
- English: Israeli ID, phone, company number, IBAN — detected with certainty (checksum, not a
  guess). Names and orgs — a real Hebrew NER model, not a generic 48-language engine.

### 3. שחזור מלא, מקומי / Full restore, local
- עברית: המיפוי בין הטוקן לערך המקורי חי רק בדפדפן שלך. אצל המתחרים הוא יושב ב-vault בשרת שלהם —
  כלומר הם מחזיקים את המידע המקורי. אצלנו — אף אחד לא.
- English: The token→original mapping lives only in your browser. Competitors keep it in a
  server-side vault — meaning they hold your originals. We don't. Nobody does.

### 4. חינם ופתוח / Free and open
- עברית: בלי קרדיטים, בלי מגבלת עמודים, בלי כרטיס אשראי. רץ מקומי, אז אין לנו עלות שרת להעביר אליך.
- English: No credits, no page limits, no credit card. It runs locally, so there is no server
  cost to pass on to you.

---

## Objection handling

**"איך אני יודע שזה באמת לא נשלח לשרת?"**
> פתח את כלי הרשת (Network) בדפדפן. חוץ מהורדת המודל פעם אחת — אין אף בקשת רשת. הכל שקוף ובר-בדיקה.
> (English: Open the browser Network tab. Apart from the one-time model download, there is not a
> single network request. Fully transparent and verifiable.)

**"זה מדויק כמו הכלים בתשלום?"**
> לגבי ישראל — יותר. מספרים (ת"ז/טלפון/IBAN) דטרמיניסטיים עם בדיקת ביקורת; שמות בעברית עם מודל
> ייעודי. אנחנו לא מזייפים זיהוי אף פעם — אם משהו לא זוהה, נגיד.
> (English: For Israeli data — more accurate. Numbers are deterministic with checksums; Hebrew
> names use a dedicated model. We never fake a detection — if something isn't caught, we say so.)

**"למה חינם? מה התפוס?"**
> אין תפוס. אין שרת = אין עלות משתנה = אין סיבה לגבות לפי עמוד. הפרטיות היא המוצר, לא המידע שלך.
> (English: No catch. No server = no variable cost = no reason to charge per page. Privacy is the
> product, not your data.)

---

## Taglines (pick per surface)

עברית:
- "המידע לא עוזב את המכשיר."
- "אף אחד לא רואה. גם לא אנחנו."
- "השחר לפני ה-AI."
- "פרטיות לפי ארכיטקטורה, לא לפי הבטחה."

English:
- "Your data never leaves your device."
- "Nobody sees it. Not even us."
- "Anonymize before the AI."
- "Privacy by architecture, not by promise."

---

## Channels & surfaces (where copy is used)

- **Chrome Web Store listing** — lead with pillar 1 + killer use case. Hebrew primary.
- **Extension popup** — short: tagline + "השחר לפני ה-AI" flow. All via i18n keys.
- **Landing page (future web app)** — full pillars, objection handling, Network-tab proof demo.
- **Israeli legal/professional communities** — lean on pillar 2 (Israeli accuracy) + Bar ethics angle.

> Reminder: none of this ships as hardcoded text. Add keys to the i18n layer (he + en) and test
> both RTL and LTR on layout.
