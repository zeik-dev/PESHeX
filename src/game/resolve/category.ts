import { firstHit, type Resolved, type ResolveCtx, resolved } from "./common";

/** Hoja de categorías de movimiento del juego: 3 cuadros APILADOS (Físico, Especial, Estado). */
export interface CategorySheet extends Resolved {
  frameW: number;
  frameH: number;
}

const DIRS = ["graphics/ui", "graphics/pictures", "graphics/ui/summary", "graphics/pictures/summary"];

/** `category.png` de la carpeta del juego (Essentials v16-v21: 64×84 = 3 cuadros de 64×28). null si no la hay o no tiene
 *  la forma esperada (alto divisible entre 3 y cuadros más anchos que altos). */
export function resolveCategorySheet(ctx: ResolveCtx): CategorySheet | null {
  const hit = firstHit(ctx.index, [...ctx.layout.summary, ...DIRS], ["category", "categories"]);
  if (!hit) return null;
  const { w, h } = hit.entry;
  if (h < 9 || h % 3 !== 0 || w < h / 3) return null;
  return { ...resolved(hit.entry, "exact"), frameW: w, frameH: h / 3 };
}
