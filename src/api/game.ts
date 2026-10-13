// Comandos de la carpeta del juego: los del driver Ruby (datos) y los de Rust
// (escaneo de Graphics/, lectura segura de imagenes, mapa manual).

import { invoke } from "@tauri-apps/api/core";
import type { AssetMap } from "../game/assetmap";
import type { Catalog, GameScan, GameSource, GameStatus, SpeciesDetail, SpeciesExtras } from "../game/types";
import { driverCall, toApiError } from "./tauri";

async function rust<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toApiError(e);
  }
}

export const gameApi = {
  // driver (Ruby)
  setFolder: async (path: string | null, source: GameSource = "manual") =>
    (await driverCall<{ game: GameStatus }>("set_game_folder", { path, source })).game,
  /** Carga por pasos (progreso real): begin devuelve los pasos; cada `linkStep` carga uno; `linkFinish` vincula. */
  linkBegin: (path: string | null, source: GameSource = "manual") =>
    driverCall<{ root: string | null; steps: string[] }>("game_link_begin", { path, source }),
  linkStep: (step: string) => driverCall<{ step: string }>("game_link_step", { step }),
  linkFinish: async () => (await driverCall<{ game: GameStatus }>("game_link_finish")).game,
  status: async () => (await driverCall<{ game: GameStatus }>("get_game_status")).game,
  catalog: async (kinds?: string[]) => (await driverCall<{ catalog: Catalog }>("get_catalog", { kinds })).catalog,
  species: async (id: string | number, form = 0) =>
    (await driverCall<{ species: SpeciesDetail }>("get_species", { species: id, form })).species,
  speciesExtras: (id: string, form = 0) => driverCall<SpeciesExtras>("get_species_extras", { species: id, form }),
  calcStats: (params: Record<string, unknown>) =>
    driverCall<{
      stats: Record<string, number>; cached?: Record<string, number | null>; match?: boolean; trusted: boolean;
      growthRate: string; expAtLevel: number; expAtNext: number;
    }>("calc_stats", params),
  expForLevel: (params: { species: string; form?: number; level?: number; exp?: number }) =>
    driverCall<{ growthRate: string; exp: number; level: number }>("exp_for_level", params),

  // Rust
  scan: (root: string) => rust<GameScan>("scan_game_folder", { root }),
  forget: () => rust<void>("forget_game_folder"),
  readFile: async (rel: string): Promise<Uint8Array> => {
    const data = await rust<ArrayBuffer | number[]>("read_game_file", { rel });
    return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
  },
  assetMapLoad: (root: string) => rust<unknown>("assetmap_load", { root }),
  assetMapSave: (root: string, map: AssetMap) => rust<void>("assetmap_save", { root, map }),
};
