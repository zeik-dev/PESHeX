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
