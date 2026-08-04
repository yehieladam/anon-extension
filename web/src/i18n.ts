/**
 * i18next init — Hebrew only at launch, but every UI string flows through keys so English is a
 * later copy-only swap (CLAUDE.md P0I-05). `escapeValue:false` is safe here because React escapes.
 *
 * SECURITY: never render a translation via `dangerouslySetInnerHTML` (or a `<Trans>` with raw HTML)
 * while `escapeValue:false` is set, and never interpolate user/PII values into a translation that is
 * rendered as HTML — that would be an XSS path. Keep translations plain text rendered by React.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { he } from "./locales/he";

void i18n.use(initReactI18next).init({
  resources: { he: { translation: he } },
  lng: "he",
  fallbackLng: "he",
  interpolation: { escapeValue: false },
});

export default i18n;
