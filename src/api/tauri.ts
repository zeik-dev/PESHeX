// Puente con el backend Tauri. TODO el trafico hacia el motor Ruby pasa por
// `driver_call` (comando generico); la UI nunca reimplementa logica del save.

import { invoke } from "@tauri-apps/api/core";
import type { ApiError, OpenResult } from "./types";

/** Normaliza lo que rechaza `invoke` (objeto del backend o texto suelto). */
export function toApiError(e: unknown): ApiError {
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    const o = e as ApiError;
    return { kind: String(o.kind), message: String(o.message), params: o.params ?? null, fatal: !!o.fatal };
  }
  if (typeof e === "string") return { kind: "default", message: e };
  if (e instanceof Error) return { kind: "default", message: e.message };
  return { kind: "default", message: String(e) };
}

type RevisionListener = (revision: number) => void;
let revisionListener: RevisionListener | null = null;

/** El store de sesion se suscribe aqui para enterarse de la `revision` que
 *  trae cada respuesta (sube con cada mutacion). */
export function onRevision(fn: RevisionListener | null) {
  revisionListener = fn;
}

export async function driverCall<T = Record<string, unknown>>(
  cmd: string,
  params: Record<string, unknown> = {},
): Promise<T & { revision?: number }> {
  try {
    const res = await invoke<T & { revision?: number }>("driver_call", { cmd, params });
    if (res && typeof (res as { revision?: unknown }).revision === "number") {
      revisionListener?.((res as { revision: number }).revision);
    }
    return res;
  } catch (e) {
    throw toApiError(e);
  }
}

export async function openSave(path: string): Promise<OpenResult> {
  try {
    return await invoke<OpenResult>("open_save", { path, scripts: [], autodetect: true, pageSize: 150 });
  } catch (e) {
    throw toApiError(e);
  }
}

export async function closeSave(): Promise<void> {
  try {
    await invoke("close_save");
  } catch (e) {
    throw toApiError(e);
  }
}

/** Vuelve a leer del disco el save abierto (lo guardo otro programa, p. ej. el juego). La sesion del motor sigue (conserva la
 *  carpeta del juego y el modo) y se pierden los cambios sin guardar; si el archivo esta a medio escribir, rechaza y todo queda
 *  como estaba. */
export async function reloadSave(): Promise<OpenResult> {
  try {
    return await invoke<OpenResult>("reload_save");
  } catch (e) {
    throw toApiError(e);
  }
}

/** Aviso de Rust: otro programa reescribio el save abierto (`path`). Devuelve la funcion para dejar de escuchar (no hace nada
 *  fuera de Tauri). */
export async function onSaveChanged(cb: (e: { path: string }) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<{ path: string }>("save://changed", (e) => cb(e.payload));
  } catch {
    return () => undefined;
  }
}
