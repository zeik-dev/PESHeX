import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { initI18n, resolveLang, setLanguage, systemLocales, type Lang, type LangPref } from "../i18n";

export type ThemePref = "auto" | "light" | "dark";
export type BallTheme = "classic" | "great" | "ultra" | "master";
export type EditMode = "hex" | "hax";

interface SettingsState {
  lang: LangPref;
  theme: ThemePref;
  ball: BallTheme;
  backup: boolean;
  /** HeX = solo cambios legales segun el juego; HaX = cualquier cambio. Por defecto HeX. */
  mode: EditMode;
  recent: string[];
  /** Carpeta del juego recordada por save (ruta del save -> raiz del juego). */
  gameFolders: Record<string, string>;
  /** Juegos vinculados antes (el mas reciente primero). */
  recentGames: string[];
  setLang: (lang: LangPref) => void;
  setTheme: (theme: ThemePref) => void;
  setBall: (ball: BallTheme) => void;
  setBackup: (backup: boolean) => void;
  setMode: (mode: EditMode) => void;
  pushRecent: (path: string) => void;
  removeRecent: (path: string) => void;
  /** Registra la raiz de un juego vinculado (la asocia al save abierto). */
  rememberGame: (root: string, savePath?: string | null) => void;
  forgetGameFor: (savePath: string) => void;
}

// localStorage puede faltar o lanzar (ventana privada, datos bloqueados):
// la app debe funcionar igual, solo que sin recordar las preferencias.
const STORE_KEY = "peshex-settings";
// La app se llamaba "PBS Editor": se lee la clave antigua una sola vez para no
// perder idioma, tema y recientes de quien actualiza.
const LEGACY_STORE_KEY = "pbs-editor-settings";

const safeStorage = {
  getItem: (name: string) => {
    try {
      const value = localStorage.getItem(name);
      if (value === null && name === STORE_KEY) return localStorage.getItem(LEGACY_STORE_KEY);
      return value;
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
      mode: "hex",
      recent: [],
      gameFolders: {},
      recentGames: [],
      setLang: (lang) => set({ lang }),
      setTheme: (theme) => set({ theme }),
      setBall: (ball) => set({ ball }),
      setBackup: (backup) => set({ backup }),
      setMode: (mode) => set({ mode }),
      pushRecent: (path) =>
        set((s) => ({ recent: [path, ...s.recent.filter((p) => p !== path)].slice(0, 6) })),
      removeRecent: (path) => set((s) => ({ recent: s.recent.filter((p) => p !== path) })),
      rememberGame: (root, savePath) =>
        set((s) => ({
          recentGames: [root, ...s.recentGames.filter((g) => g !== root)].slice(0, 8),
          gameFolders: savePath ? { ...s.gameFolders, [savePath]: root } : s.gameFolders,
        })),
      forgetGameFor: (savePath) =>
        set((s) => {
          const { [savePath]: _gone, ...rest } = s.gameFolders;
          return { gameFolders: rest };
        }),
    }),
    { name: STORE_KEY, storage: createJSONStorage(() => safeStorage), version: 1 },
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
