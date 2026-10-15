// Biblioteca de juegos («Mis juegos»): comandos de Rust (src-tauri/src/games.rs). El registro, el Save Scan y la precarga
// viven en el backend; la UI solo los pide y pinta.

import { invoke } from "@tauri-apps/api/core";
import { toApiError } from "./tauri";

/** De donde sale la carpeta de partidas que encontro el Save Scan. */
export type SaveSource = "manual" | "appData" | "gameSubdir" | "gameRoot";

export interface SaveFile {
  name: string;
  path: string;
  size: number;
  /** Segundos desde 1970. */
  modified: number | null;
}

export interface SaveCandidate {
  dir: string;
  source: SaveSource;
  count: number;
}

export interface SaveScan {
  dir: string | null;
  source: SaveSource | null;
  files: SaveFile[];
  candidates: SaveCandidate[];
}

export interface LastScan {
  dir: string | null;
  source: SaveSource | null;
  count: number;
  at: number;
}

export interface GameEntry {
  id: string;
  root: string;
  name: string;
  title: string | null;
  addedAt: number;
  lastOpenedAt: number | null;
  /** Carpetas de partidas elegidas a mano. */
  saveDirs: string[];
  lastScan: LastScan | null;
  indexedAt: number | null;
  fingerprint: string | null;
}

export interface GameAdded {
  game: GameEntry;
  created: boolean;
  scan: SaveScan;
}

/** Progreso de «Precargar» (`games://preload`): un paso, o `done: true` al terminar. */
export interface PreloadEvent {
  id: string;
  step?: string;
  done: number | boolean;
  total: number;
}

async function rust<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toApiError(e);
  }
}

export const gamesApi = {
  list: () => rust<GameEntry[]>("games_list"),
  add: (root: string) => rust<GameAdded>("games_add", { root }),
  remove: (id: string) => rust<void>("games_remove", { id }),
  rename: (id: string, name: string) => rust<void>("games_rename", { id, name }),
  touch: (id: string) => rust<void>("games_touch", { id }),
  scanSaves: (id: string) => rust<SaveScan>("games_scan_saves", { id }),
  addSaveDir: (id: string, dir: string) => rust<SaveScan>("games_add_save_dir", { id, dir }),
  removeSaveDir: (id: string, dir: string) => rust<SaveScan>("games_remove_save_dir", { id, dir }),
  findForSave: (path: string) => rust<GameEntry | null>("games_find_for_save", { path }),
  seed: (roots: string[]) => rust<number>("games_seed", { roots }),
  cacheDir: (root: string) => rust<string>("games_cache_dir", { root }),
  preload: (id: string) => rust<{ id: string; cached: boolean; state?: string | null }>("games_preload", { id }),
  preloading: () => rust<string[]>("games_preloading"),
};

/** Escucha el progreso de «Precargar». Devuelve la funcion para dejar de escuchar (no hace nada fuera de Tauri). */
export async function onPreload(cb: (e: PreloadEvent) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<PreloadEvent>("games://preload", (e) => cb(e.payload));
  } catch {
    return () => undefined;
  }
}
