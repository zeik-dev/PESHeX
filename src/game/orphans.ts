// Iconos de Pokemon que la convencion de nombres no resuelve: que especies se quedan sin
// icono y que archivos de la carpeta de iconos no usa ninguna especie. Con eso el usuario
// puede asignarlos a mano (assetmap.json) o aceptar una sugerencia por parecido.

import type { AssetEntry } from "./assetIndex";
import type { ResolveCtx } from "./resolve/common";
import { iconNameCandidates, mapKey, resolvePokemonIcon } from "./resolve/pokemon";
import { pad3 } from "./normalize";
import type { CatSpecies } from "./types";

export interface MissingSpecies {
  /** Clave del mapa manual ("TORRACAT"). */
  key: string;
  species: string;
  name: string;
  number: number | null;
}

export interface OrphanReport {
  missing: MissingSpecies[];
  orphans: AssetEntry[];
}

const GENERIC = /^(000|egg)/;

export function findOrphans(ctx: ResolveCtx, species: CatSpecies[]): OrphanReport {
  const dir = ctx.layout.pokemonIcons;
  if (!dir) return { missing: [], orphans: [] };
  const used = new Set<string>();
  const missing: MissingSpecies[] = [];
  for (const s of species) {
    const r = resolvePokemonIcon(ctx, { species: s.species, form: s.form, number: s.number });
    if (r && r.via !== "generic") used.add(r.path.toLowerCase());
    else if (s.form === 0) missing.push({ key: mapKey({ species: s.species, form: 0 }), species: s.species, name: s.name ?? s.species, number: s.number });
  }
  const ignored = new Set((ctx.map?.ignore ?? []).map((p) => p.toLowerCase()));
  const orphans = ctx.index
    .list(dir)
    .filter((e) => !used.has(e.path.toLowerCase()) && !ignored.has(e.path.toLowerCase()) && !GENERIC.test(e.name));
  return { missing, orphans };
}

/** Imagen de referencia de una especie (sprite de combate) para compararla con los iconos huerfanos. */
export function referenceSprite(ctx: ResolveCtx, s: Pick<CatSpecies, "species" | "number">): AssetEntry | undefined {
  const { index, layout } = ctx;
  if (layout.numbered) {
    return s.number == null ? undefined : index.get("graphics/battlers", pad3(s.number));
  }
  for (const dir of ["graphics/pokemon/front", "graphics/battlers"]) {
    for (const name of iconNameCandidates({ species: s.species })) {
      const hit = index.get(dir, name);
      if (hit) return hit;
    }
  }
  return undefined;
}
