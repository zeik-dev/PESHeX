import type { AssetEntry, AssetIndex } from "../assetIndex";
import type { AssetMap } from "../assetmap";
import type { Layout } from "../layout";

export interface ResolveCtx {
  index: AssetIndex;
  layout: Layout;
  map: AssetMap | null;
}

/** `exact` = nombre esperado; `fallback` = variante menos especifica (forma base,
 *  sin genero...); `fuzzy` = coincidencia aproximada; `map` = elegido por el usuario;
 *  `generic` = imagen "desconocido" del propio juego. */
export type Via = "map" | "exact" | "fallback" | "fuzzy" | "generic";

export interface Resolved {
  path: string;
  w: number;
  h: number;
  via: Via;
}

export interface IconResolved extends Resolved {
  /** Cuadros de la tira (los iconos de equipo traen 2 en horizontal). */
  frames: number;
  frameW: number;
  frameH: number;
}

export function resolved(entry: AssetEntry, via: Via): Resolved {
  return { path: entry.path, w: entry.w, h: entry.h, via };
}

/** Una tira horizontal de cuadros cuadrados (w = n * h) se recorta al primer cuadro. */
export function frameInfo(w: number, h: number): { frames: number; frameW: number; frameH: number } {
  if (h > 0 && w >= h * 1.5) {
    const frames = Math.max(1, Math.round(w / h));
    return { frames, frameW: w / frames, frameH: h };
  }
  return { frames: 1, frameW: w, frameH: h };
}

/** Primer (dir, nombre) existente; `via` segun si fue el primer candidato. */
export function firstHit(
  index: AssetIndex,
  dirs: (string | null)[],
  names: string[],
): { entry: AssetEntry; nameIndex: number } | null {
  for (const dir of dirs) {
    if (!dir) continue;
    for (let i = 0; i < names.length; i++) {
      const entry = index.get(dir, names[i]);
      if (entry) return { entry, nameIndex: i };
    }
  }
  return null;
}
