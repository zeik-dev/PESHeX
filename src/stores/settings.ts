import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { initI18n, resolveLang, setLanguage, systemLocales, type Lang, type LangPref } from "../i18n";
import { applyZoom, clampZoom, ZOOM_DEFAULT } from "../lib/zoom";

export type ZoomMode = "auto" | "manual";
/** Pestañas de la pantalla de inicio: partidas recientes o juegos guardados («Mis juegos»). */
export type OpenTab = "recent" | "games";

export type ThemePref = "auto" | "light" | "dark";
export type BallTheme = "classic" | "great" | "ultra" | "master";
export type EditMode = "hex" | "hax";

interface SettingsState {
  lang: LangPref;
  theme: ThemePref;
  ball: BallTheme;
  backup: boolean;
  /** Zoom manual de la app en porcentaje (50-200). Solo cuenta con `zoomMode: "manual"`. */
  zoom: number;
  /** `auto` (por defecto): la escala sigue al tamaño de la ventana para que quepan todas las pestañas sin scroll. */
  zoomMode: ZoomMode;
  /** Se completó el asistente del primer arranque (idioma y carpeta de juego). */
  firstRunDone: boolean;
  /** Tarjeta "Legalidad" del Resumen (solo existe en HeX): desplegada o plegada. */
  legalityOpen: boolean;
  /** Ficha del Pokémon en el editor: estadísticas base de la especie en este juego o las actuales (con el desglose). */
  cardStatsView: "base" | "current";
  /** Editor de Pokémon (solo HaX; en HeX siempre se filtra): mostrar solo las habilidades / los movimientos de la especie. */
  onlySpeciesAbilities: boolean;
  onlySpeciesMoves: boolean;
  /** HaX = cualquier cambio (por defecto); HeX = solo cambios legales segun el juego, se activa a mano. */
  mode: EditMode;
  recent: string[];
  /** Carpeta del juego recordada por save (ruta del save -> raiz del juego). */
  gameFolders: Record<string, string>;
  /** Juegos vinculados antes (el mas reciente primero). */
  recentGames: string[];
  /** Partidas para las que el usuario pidio «No volver a preguntar» por la carpeta del juego. */
  noGamePrompt: Record<string, true>;
  /** Última pestaña elegida en la pantalla de inicio; `null` = automática (recientes si las hay, si no, juegos). */
  openTab: OpenTab | null;
  /** Recargar el save abierto cuando otro programa (el juego) lo reescribe. */
  autoReload: boolean;
  /** Buscar actualizaciones al iniciar. */
  updateCheckOnStart: boolean;
  /** Version que el usuario eligio omitir (no se vuelve a avisar de ella). */
  updateSkipped: string | null;
  setLang: (lang: LangPref) => void;
  setTheme: (theme: ThemePref) => void;
  setBall: (ball: BallTheme) => void;
  setBackup: (backup: boolean) => void;
  setZoom: (zoom: number) => void;
  setZoomMode: (mode: ZoomMode) => void;
  setFirstRunDone: (done: boolean) => void;
  setLegalityOpen: (open: boolean) => void;
  setCardStatsView: (view: "base" | "current") => void;
  setOnlySpeciesAbilities: (v: boolean) => void;
  setOnlySpeciesMoves: (v: boolean) => void;
  setMode: (mode: EditMode) => void;
  pushRecent: (path: string) => void;
  removeRecent: (path: string) => void;
  /** Registra la raiz de un juego vinculado (la asocia al save abierto). */
  rememberGame: (root: string, savePath?: string | null) => void;
  forgetGameFor: (savePath: string) => void;
  setNoGamePrompt: (savePath: string, dontAsk: boolean) => void;
  setOpenTab: (tab: OpenTab | null) => void;
  setAutoReload: (v: boolean) => void;
  setUpdateCheckOnStart: (v: boolean) => void;
  setUpdateSkipped: (version: string | null) => void;
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
      lang: "es",
      theme: "auto",
      ball: "classic",
      backup: true,
      zoom: ZOOM_DEFAULT,
      zoomMode: "auto",
      firstRunDone: false,
      legalityOpen: true,
      cardStatsView: "base",
      onlySpeciesAbilities: true,
      onlySpeciesMoves: true,
      mode: "hax",
      recent: [],
      gameFolders: {},
      recentGames: [],
      noGamePrompt: {},
      openTab: null,
      autoReload: true,
      updateCheckOnStart: true,
      updateSkipped: null,
      setLang: (lang) => set({ lang }),
      setTheme: (theme) => set({ theme }),
      setBall: (ball) => set({ ball }),
      setBackup: (backup) => set({ backup }),
      setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
      setZoomMode: (zoomMode) => set({ zoomMode }),
      setFirstRunDone: (firstRunDone) => set({ firstRunDone }),
      setLegalityOpen: (legalityOpen) => set({ legalityOpen }),
      setCardStatsView: (cardStatsView) => set({ cardStatsView }),
      setOnlySpeciesAbilities: (onlySpeciesAbilities) => set({ onlySpeciesAbilities }),
      setOnlySpeciesMoves: (onlySpeciesMoves) => set({ onlySpeciesMoves }),
      setMode: (mode) => set({ mode }),
      setOpenTab: (openTab) => set({ openTab }),
      setAutoReload: (autoReload) => set({ autoReload }),
      setUpdateCheckOnStart: (updateCheckOnStart) => set({ updateCheckOnStart }),
      setUpdateSkipped: (updateSkipped) => set({ updateSkipped }),
      pushRecent: (path) =>
        set((s) => ({ recent: [path, ...s.recent.filter((p) => p !== path)].slice(0, 6) })),
      removeRecent: (path) => set((s) => ({ recent: s.recent.filter((p) => p !== path) })),
      rememberGame: (root, savePath) =>
        set((s) => ({
          recentGames: [root, ...s.recentGames.filter((g) => g !== root)].slice(0, 8),
          gameFolders: savePath ? { ...s.gameFolders, [savePath]: root } : s.gameFolders,
        })),
      setNoGamePrompt: (savePath, dontAsk) =>
        set((s) => {
          const { [savePath]: _gone, ...rest } = s.noGamePrompt;
          return { noGamePrompt: dontAsk ? { ...rest, [savePath]: true } : rest };
        }),
      forgetGameFor: (savePath) =>
        set((s) => {
          const { [savePath]: _gone, ...rest } = s.gameFolders;
          return { gameFolders: rest };
        }),
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => safeStorage),
      version: 3,
      // v2: el modo por defecto pasa de HeX a HaX. Lo que haya guardado hasta ahora era el valor por defecto, no una
      // eleccion: se restablece (HeX vuelve a elegirse a mano, con su aviso).
      // v3: asistente del primer arranque y zoom automatico. Quien ya usaba la app no vuelve a pasar por el asistente, y
      // si habia cambiado el zoom a mano lo conserva (modo manual); quien lo tenia en el 100 % por defecto pasa a automatico.
      migrate: (persisted, from) => {
        let s = persisted as Partial<SettingsState>;
        if (from < 2) s = { ...s, mode: "hax" };
        if (from < 3) s = { ...s, firstRunDone: true, zoomMode: s.zoom != null && s.zoom !== ZOOM_DEFAULT ? "manual" : "auto" };
        return s as SettingsState;
      },
    },
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
  // WebView2 no recuerda el zoom entre ejecuciones. En modo automático lo calcula `useAutoZoom` con el tamaño de la ventana.
  if (s.zoomMode === "manual") void applyZoom(s.zoom);
  useSettings.subscribe((state, prev) => {
    if (state.zoomMode === "manual" && (state.zoom !== prev.zoom || prev.zoomMode !== "manual")) void applyZoom(state.zoom);
    if (state.lang !== prev.lang) setLanguage(effectiveLang(state.lang));
    if (state.theme !== prev.theme || state.ball !== prev.ball) applyAppearance(state.theme, state.ball);
  });
}

/** ¿Está activo el modo HeX? Todo lo relativo a legalidad (tarjetas, insignias, interruptores, pestañas, avisos)
 *  solo existe con HeX activo; en HaX la interfaz no muestra nada de legalidad. */
export function useHexMode(): boolean {
  return useSettings((s) => s.mode === "hex");
}
