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

interface GameState {
  status: GameStatus;
  linking: boolean;
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
    set({ linking: true, error: null });
    try {
      // 1. Datos (Ruby): nombres, limites, calibracion. Normaliza la raiz.
      const status = await gameApi.setFolder(path, source);
      const root = status.root ?? path;
      // 2. Graphics (Rust) y catalogo (Ruby) en paralelo.
      const [scan, catalog, rawMap] = await Promise.all([
        status.folder?.hasGraphics ? gameApi.scan(root) : Promise.resolve(null),
        status.data && status.data.state !== "error" ? gameApi.catalog() : Promise.resolve(null),
        gameApi.assetMapLoad(root).catch(() => null),
      ]);
      clearAssetCache();
      const index = scan ? new AssetIndex(scan.files) : null;
      const layout = index ? detectLayout(index) : null;
      const map = normalizeMap(rawMap);
      set({
        status, linking: false, index, layout, map, scanTruncated: !!scan?.truncated,
        catalog, catalogIndex: catalog ? indexCatalog(catalog) : null, ctx: makeCtx(index, layout, map),
      });
      useSettings.getState().rememberGame(root, savePath);
      return true;
    } catch (e) {
      const err = toApiError(e);
      set({ linking: false, error: err });
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
    const remembered = settings.gameFolders[savePath];
    if (remembered) {
      if (await get().link(remembered, "remembered", savePath)) return;
      settings.forgetGameFor(savePath); // la carpeta ya no existe
    }
    // Juegos v19+: el save vive en %APPDATA%\<Juego>\ -> casar con un juego visto antes.
    const parent = parentName(savePath);
    const known = settings.recentGames.find((g) => parent && baseName(g) === parent);
    if (known && (await get().link(known, "remembered", savePath))) return;
    if (suggestion && (await get().link(suggestion, "auto", savePath))) return;
    set({ ...blank });
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
