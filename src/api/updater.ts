// Actualizaciones desde GitHub Releases: comandos de Rust (src-tauri/src/updater.rs), que a su vez dirigen al proceso
// `PESHeX-Updater.exe`. La UI solo pide, escucha el evento `updater://event` y pinta.

import { invoke } from "@tauri-apps/api/core";
import { toApiError } from "./tauri";

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
}

export interface ReleaseInfo {
  tag: string;
  /** Sin la `v`: `1.2.0`. */
  version: string;
  name: string;
  /** Notas del Release (Markdown). */
  notes: string;
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
  asset: UpdateAsset;
  sumsUrl: string;
}

export type CheckResult =
  | { status: "unavailable" }
  | { status: "upToDate"; current: string; latest: string }
  | { status: "available"; release: ReleaseInfo }
  | { status: "error"; code: string; message: string };

/** Mensajes del actualizador (el evento `updater://event`). */
export type UpdaterEvent =
  | { event: "state"; state: "downloading" | "paused" | "verifying" | "extracting" | "ready" | "applying" | "cancelled" }
  | { event: "progress"; downloaded: number; total: number; bytesPerSec: number }
  | { event: "verified"; sha256: string }
  | { event: "error"; code: string; message: string }
  | { event: "done"; version: string }
  /** El proceso del actualizador termino (`code` nulo si lo mataron). */
  | { event: "exited"; code: number | null };

/** Resultado del ultimo reemplazo, escrito por el actualizador para la app recien abierta. */
export interface UpdateResult {
  ok: boolean;
  version: string;
  code?: string;
  message?: string;
}

export type UpdateControl = "pause" | "resume" | "cancel";

async function rust<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toApiError(e);
  }
}

export const updaterApi = {
  /** ¿Esta copia de PESHeX puede actualizarse sola? (hay actualizador junto al ejecutable) */
  available: () => rust<boolean>("update_available"),
  check: () => rust<CheckResult>("update_check"),
  start: (release: ReleaseInfo) => rust<void>("update_start", { release }),
  control: (action: UpdateControl) => rust<void>("update_control", { action }),
  /** Cierra el driver, ordena instalar y sale: el actualizador reemplaza los archivos y vuelve a abrir PESHeX. */
  apply: () => rust<void>("update_apply"),
  lastResult: () => rust<UpdateResult | null>("update_last_result"),
};

/** Escucha los eventos del actualizador. Devuelve la funcion para dejar de escuchar (no hace nada fuera de Tauri). */
export async function onUpdaterEvent(cb: (e: UpdaterEvent) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<UpdaterEvent>("updater://event", (e) => cb(e.payload));
  } catch {
    return () => undefined;
  }
}
