import { create } from "zustand";
import { gamesApi, onPreload, type GameEntry, type SaveScan } from "../api/games";
import { errorText } from "../lib/errors";
import { toApiError } from "../api/tauri";
import i18n from "../i18n";
import { useSettings } from "./settings";
import { useToasts } from "./toasts";

export interface PreloadProgress {
  step: string;
  done: number;
  total: number;
}

interface GamesState {
  games: GameEntry[];
  loaded: boolean;
  /** Ultimo Save Scan de cada juego (sus partidas), por id. */
  scans: Record<string, SaveScan>;
  /** Juegos que se estan precargando ahora, con su progreso real. */
  preload: Record<string, PreloadProgress>;
  /** Carga la biblioteca (y siembra la primera vez con los juegos recientes de versiones anteriores). */
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Registra una carpeta de juego; devuelve el juego o null si no se pudo (ya avisa con un aviso). */
  add: (root: string) => Promise<GameEntry | null>;
  /** Registro silencioso de un juego recien vinculado (no avisa si falla; marca el juego como abierto ahora). */
  registerLinked: (root: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  rescan: (id: string) => Promise<void>;
  rescanAll: () => Promise<void>;
  addSaveDir: (id: string, dir: string) => Promise<void>;
  removeSaveDir: (id: string, dir: string) => Promise<void>;
  startPreload: (id: string) => Promise<void>;
}

function fail(e: unknown) {
  useToasts.getState().push({ kind: "error", text: errorText(i18n.t.bind(i18n), toApiError(e)) });
}

let started = false;

export const useGames = create<GamesState>((set, get) => ({
  games: [],
  loaded: false,
  scans: {},
  preload: {},

  async init() {
    if (started) return;
    started = true;
    await onPreload((e) => {
      if (e.done === true) {
        set((s) => {
          const { [e.id]: _gone, ...rest } = s.preload;
          return { preload: rest };
        });
        void get().refresh();
      } else {
        set((s) => ({ preload: { ...s.preload, [e.id]: { step: e.step ?? "species", done: Number(e.done), total: e.total } } }));
      }
    });
    try {
      let list = await gamesApi.list();
      // Primera vez con la biblioteca: se siembra con los juegos que la app ya conocia (versiones anteriores).
      const known = useSettings.getState().recentGames;
      if (list.length === 0 && known.length > 0) {
        await gamesApi.seed(known).catch(() => 0);
        list = await gamesApi.list();
      }
      set({ games: list ?? [], loaded: true });
      const running = await gamesApi.preloading().catch(() => [] as string[]);
      if (running?.length) set((s) => ({ preload: { ...s.preload, ...Object.fromEntries(running.map((id) => [id, { step: "species", done: 0, total: 1 }])) } }));
    } catch {
      set({ loaded: true }); // sin backend (navegador, pruebas): la biblioteca queda vacia
    }
  },

  async refresh() {
    try {
      set({ games: (await gamesApi.list()) ?? [], loaded: true });
    } catch (e) {
      fail(e);
    }
  },

  async add(root) {
    try {
      const res = await gamesApi.add(root);
      if (!res) return null;
      set((s) => ({ scans: { ...s.scans, [res.game.id]: res.scan } }));
      await get().refresh();
      return res.game;
    } catch (e) {
      fail(e);
      return null;
    }
  },

  async registerLinked(root) {
    try {
      const res = await gamesApi.add(root);
      if (!res) return;
      await gamesApi.touch(res.game.id);
      set((s) => ({ scans: { ...s.scans, [res.game.id]: res.scan } }));
      await get().refresh();
    } catch {
      /* la biblioteca es un extra: vincular el juego no depende de ella */
    }
  },

  async remove(id) {
    try {
      await gamesApi.remove(id);
      set((s) => {
        const { [id]: _scan, ...scans } = s.scans;
        return { scans };
      });
      await get().refresh();
    } catch (e) {
      fail(e);
    }
  },

  async rename(id, name) {
    try {
      await gamesApi.rename(id, name);
      await get().refresh();
    } catch (e) {
      fail(e);
    }
  },

  async rescan(id) {
    try {
      const scan = await gamesApi.scanSaves(id);
      if (scan) set((s) => ({ scans: { ...s.scans, [id]: scan } }));
      await get().refresh();
    } catch (e) {
      fail(e);
    }
  },

  async rescanAll() {
    await Promise.all(get().games.map(async (g) => {
      try {
        const scan = await gamesApi.scanSaves(g.id);
        if (scan) set((s) => ({ scans: { ...s.scans, [g.id]: scan } }));
      } catch {
        /* un juego cuya carpeta ya no existe no debe impedir ver los demas */
      }
    }));
  },

  async addSaveDir(id, dir) {
    try {
      const scan = await gamesApi.addSaveDir(id, dir);
      if (scan) set((s) => ({ scans: { ...s.scans, [id]: scan } }));
      await get().refresh();
    } catch (e) {
      fail(e);
    }
  },

  async removeSaveDir(id, dir) {
    try {
      const scan = await gamesApi.removeSaveDir(id, dir);
      if (scan) set((s) => ({ scans: { ...s.scans, [id]: scan } }));
      await get().refresh();
    } catch (e) {
      fail(e);
    }
  },

  async startPreload(id) {
    if (get().preload[id]) return;
    set((s) => ({ preload: { ...s.preload, [id]: { step: "species", done: 0, total: 1 } } }));
    try {
      await gamesApi.preload(id);
    } catch (e) {
      fail(e);
    } finally {
      set((s) => {
        const { [id]: _gone, ...rest } = s.preload;
        return { preload: rest };
      });
      await get().refresh();
    }
  },
}));
