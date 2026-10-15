import { firstHit, type Resolved, type ResolveCtx, resolved } from "./common";

/** Hoja de iconos de tipo del juego: cuadros de 64×28 APILADOS en vertical, uno por tipo (la fila la da `IconPosition`). */
export interface TypeSheet extends Resolved {
  frameW: number;
  frameH: number;
  /** Cuántos cuadros caben en la hoja. */
  rows: number;
}

const DIRS = ["graphics/ui", "graphics/pictures", "graphics/ui/summary", "graphics/pictures/summary", "graphics/ui/pokedex"];
/** Proporción del cuadro de Essentials (64×28). */
const RATIO = 28 / 64;

/** `types.png` de la carpeta del juego (Essentials v16-v21: 64 de ancho y un cuadro de 28 de alto por tipo). null si no hay o
 *  no tiene esa forma (otras hojas, como `pokedexTypes.png` o `types_ico.png`, no se confunden con esta). */
export function resolveTypeSheet(ctx: ResolveCtx): TypeSheet | null {
  const hit = firstHit(ctx.index, [...ctx.layout.summary, ...DIRS], ["types", "type_icons"]);
  if (!hit) return null;
  const { w, h } = hit.entry;
  const frameH = Math.round(w * RATIO);
  if (w < 16 || frameH < 6 || h < frameH * 2) return null;
  const rows = Math.floor(h / frameH);
  // El alto debe ser (casi) un múltiplo exacto del cuadro; si no, no es una hoja de tipos de este formato.
  if (h - rows * frameH > 1) return null;
  return { ...resolved(hit.entry, "exact"), frameW: w, frameH, rows };
}
