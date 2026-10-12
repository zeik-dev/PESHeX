import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import es from "./es.json";
import en from "./en.json";

export type Lang = "es" | "en";
export type LangPref = "auto" | Lang;

export const LANGS: readonly Lang[] = ["es", "en"];

/** Elige idioma a partir de una lista de locales ("es-ES", "en-US"...):
 *  el primero que empiece por "es" -> es; si no, en. */
export function pickLang(locales: readonly (string | null | undefined)[]): Lang {
  for (const l of locales) {
    if (!l) continue;
    const base = l.toLowerCase().split(/[-_]/)[0];
    if (base === "es") return "es";
    if (base === "en") return "en";
  }
  return "en";
}

/** Resuelve la preferencia guardada (auto|es|en) a un idioma concreto. */
export function resolveLang(pref: LangPref, systemLocales: readonly (string | null | undefined)[]): Lang {
  return pref === "auto" ? pickLang(systemLocales) : pref;
}

export function systemLocales(): string[] {
  if (typeof navigator === "undefined") return [];
  return [...(navigator.languages ?? []), navigator.language].filter(Boolean);
}

let initialized = false;

export function initI18n(lang: Lang) {
  if (!initialized) {
    void i18n.use(initReactI18next).init({
      resources: { es: { translation: es }, en: { translation: en } },
      lng: lang,
      fallbackLng: "es",
      interpolation: { escapeValue: false },
      returnNull: false,
    });
    initialized = true;
  } else {
    void i18n.changeLanguage(lang);
  }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  return i18n;
}

export function setLanguage(lang: Lang) {
  void i18n.changeLanguage(lang);
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export default i18n;
