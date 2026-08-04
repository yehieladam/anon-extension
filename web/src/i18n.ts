/**
 * i18next init — Hebrew only at launch, but every UI string flows through keys so English is a
 * later copy-only swap (CLAUDE.md P0I-05). `escapeValue:false` is safe here because React escapes.
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
