import { lookup } from "../assetmap";
import { pad2, pad3 } from "../normalize";
import { firstHit, resolved, type Resolved, type ResolveCtx } from "./common";

export interface ItemKey {
  id: string | number;
  /** Para MT/MO/DT: tipo del movimiento y tipo de maquina (3 MT, 4 MO, 5 DT). */
  machineType?: string | null;
  fieldUse?: number | null;
  number?: number | null;
}

/** Nombres de icono de objeto en orden de preferencia (modern). */
export function itemNameCandidates(k: ItemKey): string[] {
  const id = String(k.id).toLowerCase();
  const names = [id];
  if (k.machineType) {
    const t = k.machineType.toLowerCase();
    const prefix = k.fieldUse === 4 ? "machine_hm" : k.fieldUse === 5 ? "machine_tr" : "machine";
    names.push(`${prefix}_${t}`);
  }
  if (k.fieldUse === 3 || k.fieldUse === 4 || k.fieldUse === 5) names.push("machine");
  return names;
}

export function resolveItemIcon(ctx: ResolveCtx, k: ItemKey): Resolved | null {
  const { index, layout } = ctx;
  const mapped = lookup(ctx.map, "items", String(k.id));
  const mappedEntry = mapped ? index.byPath(mapped) : undefined;
  if (mappedEntry) return resolved(mappedEntry, "map");
  if (!layout.items) return null;

  if (layout.numbered) {
    const n = typeof k.id === "number" ? k.id : k.number;
    const hit = n == null ? null : firstHit(index, [layout.items], [`item${pad3(n)}`]);
    return hit ? resolved(hit.entry, "exact") : null;
  }
  const hit = firstHit(index, [layout.items], itemNameCandidates(k));
  if (hit) return resolved(hit.entry, hit.nameIndex === 0 ? "exact" : "fallback");
  const generic = firstHit(index, [layout.items], ["000"]);
  return generic ? resolved(generic.entry, "generic") : null;
}

/** Icono de la Poké Ball en las pantallas de resumen (icon_ball_<ID>); si el juego
 *  no lo trae, el icono de objeto de esa ball. */
export function resolveBallIcon(ctx: ResolveCtx, ballId: string | number, number?: number | null, ballIndex?: number | null): Resolved | null {
  const { index, layout } = ctx;
  const id = String(ballId).toLowerCase();
  const mapped = lookup(ctx.map, "balls", String(ballId));
  const mappedEntry = mapped ? index.byPath(mapped) : undefined;
  if (mappedEntry) return resolved(mappedEntry, "map");
  const hit = firstHit(index, layout.summary, [`icon_ball_${id}`]);
  if (hit) return resolved(hit.entry, "exact");
  // Bases <= v18: summaryballNN.png, con NN = indice de la bola en $BallTypes.
  if (ballIndex != null && ballIndex >= 0) {
    const legacy = firstHit(index, [...layout.summary, "graphics/pictures", "graphics/ui"], [`summaryball${pad2(ballIndex)}`]);
    if (legacy) return resolved(legacy.entry, "fallback");
  }
  return resolveItemIcon(ctx, { id: ballId, number });
}

/** Marca de "lleva objeto" de las pantallas de equipo/PC. */
export function resolveHeldItemIcon(ctx: ResolveCtx): Resolved | null {
  const hit = firstHit(ctx.index, ctx.layout.party, ["icon_item"]);
  return hit ? resolved(hit.entry, "exact") : null;
}
