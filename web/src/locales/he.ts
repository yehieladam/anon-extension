/**
 * Hebrew UI strings for the Mechikon web app. Canonical source is docs/ux-copy.md §6.
 * Only the keys the current shell (P2W-01) renders are included; the rest are filled in as the
 * flow is built (P2W-02+). English (`en`) is a later copy-only swap. No hardcoded strings in
 * components — everything goes through these keys (CLAUDE.md).
 */
export const he = {
  app: {
    name: "מחיקון",
    byline: "כלי חינמי מבית BAI Solutions",
    tagline: "המידע לא עוזב את המכשיר.",
  },
  hero: {
    title: "משחירים לפני שמדביקים ל־AI. החיסיון נשאר אצלכם.",
    subtitle:
      "מחיקון מזהה ומשחיר פרטים מזהים במסמכים בעברית — שמות, ת״ז, טלפונים, מספרי תיק — והכול קורה בדפדפן שלכם בלבד. שום דבר לא נשלח לשום שרת. אף אחד לא רואה את המסמך — גם לא אנחנו.",
    cta: "להתחיל — בלי הרשמה",
  },
  flow: {
    step1: { title: "משחירים כאן" },
    step2: { title: "עובדים עם ה־AI" },
    step3: { title: "מחזירים את התשובה" },
    step4: { title: "מקבלים חזרה את המקור" },
  },
  input: {
    paste: {
      placeholder: "הדביקו כאן טקסט — חוזה, כתב טענות, מכתב… הטקסט לא יישלח לשום מקום.",
    },
    submit: "השחרת המסמך",
    working: "מזהים… הכול קורה במחשב שלכם.",
  },
  result: {
    found: "נמצאו {{count}} פרטים מזהים",
    none: "לא זוהו פרטים מזהים בטקסט. שימו לב: אף מנגנון זיהוי אינו מושלם — עברו על הטקסט לפני שיתוף.",
    anonymizedLabel: "הטקסט המושחר",
    copy: "העתקת הטקסט המושחר",
    copied: "הועתק",
    note: "בשלב זה מזוהים מספרים ופרטים מובנים (ת״ז, טלפון, IBAN, אימייל ועוד). זיהוי שמות עבריים (מנוע השפה) יתווסף בהמשך.",
  },
  restore: {
    title: "שחזור הערכים המקוריים",
    placeholder: "הדביקו כאן טקסט מושחר — למשל תשובה מ־AI שמכילה סימונים כמו [ת״ז_1] — לשחזור הערכים.",
    submit: "שחזור",
    restoredLabel: "הטקסט המשוחזר",
    unmatched: "{{count}} סימונים לא נמצאו במפתח ונותרו כפי שהם.",
  },
  trust: {
    badge: { zero: "0 בקשות רשת" },
    strip: {
      noSignup: "בלי הרשמה. בלי חשבון. בלי עוגיות. אי אפשר להדליף מידע שמעולם לא נאסף.",
      offline: "עובד גם בלי אינטרנט. נתקו את הרשת ותראו בעצמכם.",
      openSource: "קוד פתוח. כל אחד יכול לקרוא ולוודא: שום דבר לא נשלח.",
    },
    tagline: "פרטיות לפי ארכיטקטורה, לא לפי הבטחה.",
  },
  legal: {
    notAdvice:
      "מחיקון הוא כלי טכני לסיוע בהשחרת מידע, ואינו מהווה ייעוץ משפטי או תחליף לשיקול דעת מקצועי.",
    noCollection:
      "איננו אוספים מידע. אין חשבון, אין עוגיות, אין אנליטיקות, אין טלמטריה. המסמכים אינם מגיעים אלינו — טכנית אין לאן.",
    brand: "מחיקון — כלי חינמי מבית BAI Solutions.",
    sourceLink: "קוד המקור (רישיון AGPL)",
  },
} as const;

export type Translation = typeof he;
