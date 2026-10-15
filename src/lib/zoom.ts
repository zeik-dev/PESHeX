// Zoom de la aplicacion (Ajustes). En la app de escritorio es el zoom NATIVO del WebView (como Ctrl+rueda):
// las coordenadas CSS siguen siendo coherentes, asi que el arrastrar y soltar y la escala del PC no se rompen.
// Fuera de Tauri (npm run dev) se cae a `zoom` CSS en la raiz.
//
// Dos modos: manual (el porcentaje que elige el usuario) y automatico (por defecto): la escala sale del tamano de la
// ventana para que quepan TODAS las pestanas del encabezado sin scroll, y crece o se reduce al redimensionar o maximizar.

import { useSyncExternalStore } from "react";

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;
export const ZOOM_DEFAULT = 100;

/** Porcentaje entero dentro de [ZOOM_MIN, ZOOM_MAX]; lo que no sea un numero finito vale 100. */
export function clampZoom(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n)));
}

/** Sube o baja un paso (10 %), ajustando al multiplo de 10 mas cercano en esa direccion. */
export function stepZoom(current: number, dir: 1 | -1): number {
  const c = clampZoom(current);
  const next = dir === 1 ? (Math.floor(c / ZOOM_STEP) + 1) * ZOOM_STEP : (Math.ceil(c / ZOOM_STEP) - 1) * ZOOM_STEP;
  return clampZoom(next);
}

/** Alto de referencia (px CSS al 100 %): una ventana más baja que esto reduce la escala aunque las pestañas quepan. Es algo
 *  menos que el alto útil de la ventana por defecto (1100×720). */
export const ZOOM_REF_HEIGHT = 700;
/** Ancho que ocupan las pestañas a 100 % si aún no se pudo medir (sin encabezado en pantalla). */
export const FALLBACK_NAV_WIDTH = 1420;

/** Zoom automático (porcentaje entero) para una ventana: el MENOR entre lo que hace falta para que quepan todas las pestañas
 *  (ancho disponible / ancho natural) y lo que permite el alto (alto disponible / alto de referencia). Todas las medidas son
 *  en px CSS AL 100 % de zoom (invariantes al zoom actual), así que el resultado no depende de la escala aplicada ahora y no
 *  hay realimentación entre medir y aplicar. Redondea hacia abajo: nunca se pasa de ancho. */
export function fitZoom(input: {
  naturalWidth: number;
  availableWidth: number;
  availableHeight: number;
  refHeight?: number;
}): number {
  const { naturalWidth, availableWidth, availableHeight, refHeight = ZOOM_REF_HEIGHT } = input;
  if (!(naturalWidth > 0) || !(availableWidth > 0) || !(availableHeight > 0) || !(refHeight > 0)) return ZOOM_DEFAULT;
  const scale = Math.min(availableWidth / naturalWidth, availableHeight / refHeight);
  return clampZoom(Math.floor(scale * 100));
}

/** ¿Hay zoom nativo (app de escritorio)? Fuera de Tauri el zoom es `zoom` CSS y el automático no se aplica. */
export function hasNativeZoom(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Zoom que está aplicado ahora mismo (para medir con él y para mostrarlo en Ajustes).
let applied = ZOOM_DEFAULT;
const listeners = new Set<() => void>();
function setApplied(percent: number) {
  if (applied === percent) return;
  applied = percent;
  listeners.forEach((l) => l());
}
export function appliedZoom(): number {
  return applied;
}
/** Zoom aplicado ahora (reactivo). */
export function useAppliedZoom(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    appliedZoom,
    appliedZoom,
  );
}

/** Aplica el zoom: WebView nativo y, si no hay Tauri, `zoom` CSS. */
export async function applyZoom(percent: number): Promise<void> {
  const clamped = clampZoom(percent);
  const factor = clamped / 100;
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(factor);
    document.documentElement.style.removeProperty("zoom");
  } catch {
    const root = document.documentElement.style;
    if (factor === 1) root.removeProperty("zoom");
    else root.setProperty("zoom", String(factor));
  }
  setApplied(clamped);
}
