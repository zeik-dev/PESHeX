import { create } from "zustand";
import i18n from "../i18n";
import { gameApi } from "../api/game";
import { toApiError } from "../api/tauri";
import type { ApiError } from "../api/types";
import { AssetIndex } from "../game/assetIndex";
import { clearAssetCache } from "../game/assetUrl";
import { emptyMap, normalizeMap, withIgnored, withMapping, type AssetMap, type MapKind } from "../game/assetmap";
import { detectLayout, type Layout } from "../game/layout";
import type { ResolveCtx } from "../game/resolve/common";
import { indexCatalog, type CatalogIndex } from "../game/lookup";
import type { Catalog, GameSource, GameStatus } from "../game/types";
import { errorText } from "../lib/errors";
import { useSettings } from "./settings";
import { useToasts } from "./toasts";

export type { CatalogIndex } from "../game/lookup";

export const UNLINKED: GameStatus = { linked: false, legality: { level: "basic", reasons: ["no_game_folder"] } };

/** Progreso de la carga de la carpeta del juego: pasos reales (Ruby, Rust y catalogo), no una animacion simulada. */
export interface LinkProgress {
  done: number;
  total: number;
  /** Id del paso en curso (clave i18n `game.step.<id>`). */
  step: string;
}

/** Pasos que hace la UI tras `game_link_finish` (los de Ruby los lista el driver). */
const CLIENT_STEPS = ["graphics", "catalog", "assetmap"] as const;

interface GameState {
  status: GameStatus;
  linking: boolean;
  progress: LinkProgress | null;
  /** Ya se intento vincular sola la carpeta del juego tras abrir el save (recordada, reciente o sugerida). */
  autoLinkDone: boolean;
  /** Save para el que se ofrece vincular la carpeta del juego (modal de inicio), o null. */
  prompt: string | null;
  dismissPrompt: (dontAskAgain: boolean) => void;
  error: ApiError | null;
  index: AssetIndex | null;
  layout: Layout | null;
  scanTruncated: boolean;
  map: AssetMap;
  catalog: Catalog | null;
  catalogIndex: CatalogIndex | null;
  /** Contexto para los resolvedores de assets (null sin carpeta o sin Graphics/). */
  ctx: ResolveCtx | null;

  link: (path: string, source?: GameSource, savePath?: string | null) => Promise<boolean>;
  unlink: () => Promise<void>;
  /** Tras abrir un save: recuerda/sugiere/vincula la carpeta del juego. */
  onSaveOpened: (savePath: string, suggestion?: string) => Promise<void>;
  setMapping: (kind: MapKind, key: string, path: string | null) => Promise<void>;
  setIgnored: (path: string, ignored: boolean) => Promise<void>;
  reset: () => void;
}

const blank = {
  status: UNLINKED,
  linking: false,
  progress: null,
  autoLinkDone: false,
  prompt: null,
  error: null,
  index: null,
  layout: null,
  scanTruncated: false,
  map: emptyMap(),
  catalog: null,
  catalogIndex: null,
  ctx: null,
};

function makeCtx(index: AssetIndex | null, layout: Layout | null, map: AssetMap): ResolveCtx | null {
  return index && layout ? { index, layout, map } : null;
}

/** Nombre de la carpeta padre sin separadores (para casar `%APPDATA%\\MiJuego\\Game.rxdata` con `...\\MiJuego`). */
function parentName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return (parts[parts.length - 2] ?? "").toLowerCase();
}
function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

export const useGame = create<GameState>((set, get) => ({
  ...blank,

  async link(path, source = "manual", savePath = null) {
    set({ linking: true, error: null, progress: { done: 0, total: 1, step: "species" } });
    try {
      // 1. Datos (Ruby) por pasos: especies, movimientos, objetos, habilidades, tipos, apoyo, limites y calibracion.
      const begin = await gameApi.linkBegin(path, source);
      const total = begin.steps.length + CLIENT_STEPS.length;
      let done = 0;
      const mark = (step: string) => set({ progress: { done, total, step } });
      for (const id of begin.steps) {
        mark(id);
        await gameApi.linkStep(id);
        done += 1;
      }
      const status = await gameApi.linkFinish();
      const root = status.root ?? path;
      // 2. Graphics (Rust), catalogo (Ruby) y mapa manual de imagenes, uno tras otro para informar del avance.
      mark("graphics");
      const scan = status.folder?.hasGraphics ? await gameApi.scan(root) : null;
      done += 1;
      mark("catalog");
      const catalog = status.data && status.data.state !== "error" ? await gameApi.catalog() : null;
      done += 1;
      mark("assetmap");
      const rawMap = await gameApi.assetMapLoad(root).catch(() => null);
      done += 1;
      set({ progress: { done, total, step: "assetmap" } });
      clearAssetCache();
      const index = scan ? new AssetIndex(scan.files) : null;
      const layout = index ? detectLayout(index) : null;
      const map = normalizeMap(rawMap);
      set({
        status, linking: false, progress: null, prompt: null, index, layout, map, scanTruncated: !!scan?.truncated,
        catalog, catalogIndex: catalog ? indexCatalog(catalog) : null, ctx: makeCtx(index, layout, map),
      });
      useSettings.getState().rememberGame(root, savePath);
      return true;
    } catch (e) {
      const err = toApiError(e);
      set({ linking: false, progress: null, error: err });
      useToasts.getState().push({ kind: "error", text: errorText(i18n.t.bind(i18n), err) });
      return false;
    }
  },

  async unlink() {
    set({ linking: true, error: null });
    try {
      await gameApi.setFolder(null);
      await gameApi.forget().catch(() => undefined);
      clearAssetCache();
      set({ ...blank });
    } catch (e) {
      const err = toApiError(e);
      set({ linking: false, error: err });
      useToasts.getState().push({ kind: "error", text: errorText(i18n.t.bind(i18n), err) });
    }
  },

  async onSaveOpened(savePath, suggestion) {
    const settings = useSettings.getState();
    const done = () => {
      // Sin carpeta asociada: se ofrece vincularla (salvo que el usuario haya pedido no volver a preguntar).
      const ask = !get().status.linked && !useSettings.getState().noGamePrompt[savePath];
      set({ autoLinkDone: true, prompt: ask ? savePath : null });
    };
    const remembered = settings.gameFolders[savePath];
    if (remembered) {
      if (await get().link(remembered, "remembered", savePath)) return done();
      settings.forgetGameFor(savePath); // la carpeta ya no existe
    }
    // Juegos v19+: el save vive en %APPDATA%\<Juego>\ -> casar con un juego visto antes.
    const parent = parentName(savePath);
    const known = settings.recentGames.find((g) => parent && baseName(g) === parent);
    if (known && (await get().link(known, "remembered", savePath))) return done();
    if (suggestion && (await get().link(suggestion, "auto", savePath))) return done();
    set({ ...blank });
    done();
  },

  dismissPrompt(dontAskAgain) {
    const savePath = get().prompt;
    if (savePath && dontAskAgain) useSettings.getState().setNoGamePrompt(savePath, true);
    set({ prompt: null });
  },

  async setMapping(kind, key, path) {
    const { status, map, index, layout } = get();
    if (!status.root) return;
    const next = withMapping(map, kind, key, path);
    set({ map: next, ctx: makeCtx(index, layout, next) });
    await gameApi.assetMapSave(status.root, next).catch(() => undefined);
  },

  async setIgnored(path, ignored) {
    const { status, map, index, layout } = get();
    if (!status.root) return;
    const next = withIgnored(map, path, ignored);
    set({ map: next, ctx: makeCtx(index, layout, next) });
    await gameApi.assetMapSave(status.root, next).catch(() => undefined);
  },

  reset() {
    clearAssetCache();
    set({ ...blank });
  },
}));
