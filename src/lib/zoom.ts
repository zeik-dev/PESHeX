// Zoom de la aplicacion (Ajustes). En la app de escritorio es el zoom NATIVO del WebView (como Ctrl+rueda):
// las coordenadas CSS siguen siendo coherentes, asi que el arrastrar y soltar y la escala del PC no se rompen.
// Fuera de Tauri (npm run dev) se cae a `zoom` CSS en la raiz.

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

/** Aplica el zoom: WebView nativo y, si no hay Tauri, `zoom` CSS. */
export async function applyZoom(percent: number): Promise<void> {
  const factor = clampZoom(percent) / 100;
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(factor);
    document.documentElement.style.removeProperty("zoom");
  } catch {
    const root = document.documentElement.style;
    if (factor === 1) root.removeProperty("zoom");
    else root.setProperty("zoom", String(factor));
  }
}
