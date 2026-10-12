import { lookup } from "../assetmap";
import { firstHit, resolved, type Resolved, type ResolveCtx } from "./common";

/** Fondo de la caja `n` (campo @background del save; en juegos antiguos, indice de caja). */
export function resolveBoxBackground(ctx: ResolveCtx, n: number): Resolved | null {
  const { index, layout } = ctx;
  const mapped = lookup(ctx.map, "boxes", String(n));
  const mappedEntry = mapped ? index.byPath(mapped) : undefined;
  if (mappedEntry) return resolved(mappedEntry, "map");
  const hit = firstHit(index, layout.boxes, [`box_${n}`, `box${n}`]);
  return hit ? resolved(hit.entry, "exact") : null;
}

/** Medidas del bitmap de una caja del juego (324x296) y de su rejilla. Las
 *  coordenadas salen de PokemonStorageScene de Essentials; si la imagen del
 *  juego tiene otro tamano se escalan proporcionalmente. */
export const BOX_BITMAP = { w: 324, h: 296, originX: 10, originY: 30, step: 48, nameX: 162, nameY: 14 } as const;

export function boxGeometry(w: number, h: number) {
  const sx = w > 0 ? w / BOX_BITMAP.w : 1;
  const sy = h > 0 ? h / BOX_BITMAP.h : 1;
  return {
    originX: BOX_BITMAP.originX * sx,
    originY: BOX_BITMAP.originY * sy,
    stepX: BOX_BITMAP.step * sx,
    stepY: BOX_BITMAP.step * sy,
    w: w || BOX_BITMAP.w,
    h: h || BOX_BITMAP.h,
  };
}
