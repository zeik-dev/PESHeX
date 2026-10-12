import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { initI18n, resolveLang, setLanguage, systemLocales, type Lang, type LangPref } from "../i18n";

export type ThemePref = "auto" | "light" | "dark";
export type BallTheme = "classic" | "great" | "ultra" | "master";

interface SettingsState {
  lang: LangPref;
  theme: ThemePref;
  ball: BallTheme;
  backup: boolean;
  recent: string[];
  setLang: (lang: LangPref) => void;
  setTheme: (theme: ThemePref) => void;
  setBall: (ball: BallTheme) => void;
  setBackup: (backup: boolean) => void;
  pushRecent: (path: string) => void;
  removeRecent: (path: string) => void;
}

// localStorage puede faltar o lanzar (ventana privada, datos bloqueados):
// la app debe funcionar igual, solo que sin recordar las preferencias.
const safeStorage = {
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* sin persistencia */
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* sin persistencia */
    }
  },
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      lang: "auto",
      theme: "auto",
      ball: "classic",
      backup: true,
      recent: [],
      setLang: (lang) => set({ lang }),
      setTheme: (theme) => set({ theme }),
      setBall: (ball) => set({ ball }),
      setBackup: (backup) => set({ backup }),
      pushRecent: (path) =>
        set((s) => ({ recent: [path, ...s.recent.filter((p) => p !== path)].slice(0, 6) })),
      removeRecent: (path) => set((s) => ({ recent: s.recent.filter((p) => p !== path) })),
    }),
    { name: "pbs-editor-settings", storage: createJSONStorage(() => safeStorage), version: 1 },
  ),
);

export function applyAppearance(theme: ThemePref, ball: BallTheme) {
  const root = document.documentElement;
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
  if (ball === "classic") delete root.dataset.ball;
  else root.dataset.ball = ball;
}

/** Idioma efectivo segun la preferencia y el sistema. */
export function effectiveLang(pref: LangPref): Lang {
  return resolveLang(pref, systemLocales());
}

/** Inicializa i18n + apariencia y se mantiene sincronizado con el store. */
export function bootstrapSettings() {
  const s = useSettings.getState();
  initI18n(effectiveLang(s.lang));
  applyAppearance(s.theme, s.ball);
  useSettings.subscribe((state, prev) => {
    if (state.lang !== prev.lang) setLanguage(effectiveLang(state.lang));
    if (state.theme !== prev.theme || state.ball !== prev.ball) applyAppearance(state.theme, state.ball);
  });
}
