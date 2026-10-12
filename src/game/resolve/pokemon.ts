import { uniqueBestMatch } from "../fuzzy";
import { lookup } from "../assetmap";
import { pad3 } from "../normalize";
import { firstHit, frameInfo, type IconResolved, type ResolveCtx } from "./common";

export interface PokemonKey {
  /** Id interno ("BULBASAUR") o, en bases antiguas, numero de especie. */
  species: string | number;
  form?: number | null;
  /** 0 macho, 1 hembra, 2 sin genero. */
  gender?: number | null;
  shiny?: boolean;
  shadow?: boolean;
  egg?: boolean;
  /** Numero de especie (para nombres numerados de bases antiguas). */
  number?: number | null;
}

/** Clave del mapa manual: "BULBASAUR" o "BULBASAUR_1". */
export function mapKey(k: Pick<PokemonKey, "species" | "form">): string {
  const sp = String(k.species);
  return k.form && k.form > 0 ? `${sp}_${k.form}` : sp;
}

function icon(entry: { path: string; w: number; h: number }, via: IconResolved["via"]): IconResolved {
  return { path: entry.path, w: entry.w, h: entry.h, via, ...frameInfo(entry.w, entry.h) };
}

/** Candidatos de nombre de mas a menos especifico (misma prioridad que Essentials:
 *  especie+forma+genero+sombra > ... > forma > especie base > "000"). */
export function iconNameCandidates(k: PokemonKey): string[] {
  const sp = String(k.species).toLowerCase();
  const form = k.form && k.form > 0 ? k.form : 0;
  const female = k.gender === 1;
  const shadow = !!k.shadow;
  const names: string[] = [];
  const add = (n: string) => {
    if (!names.includes(n)) names.push(n);
  };
  const series = (base: string) => {
    if (female && shadow) add(`${base}_female_shadow`);
    if (shadow) add(`${base}_shadow`);
    if (female) add(`${base}_female`);
    add(base);
  };
  if (form) series(`${sp}_${form}`);
  series(sp);
  return names;
}

function legacyNames(k: PokemonKey): string[] {
  const n = typeof k.species === "number" ? k.species : k.number;
  if (n == null) return [];
  const base = `icon${pad3(n)}`;
  const form = k.form && k.form > 0 ? `_${k.form}` : "";
  const f = k.gender === 1 ? "f" : "";
  const s = k.shiny ? "s" : "";
  const out = [`${base}${f}${s}${form}`, `${base}${s}${form}`, `${base}${f}${form}`, `${base}${form}`, `${base}${f}${s}`, `${base}${s}`, base];
  return [...new Set(out)];
}

/** Icono de equipo/PC de un Pokemon, o null si el juego no tiene ninguno. */
export function resolvePokemonIcon(ctx: ResolveCtx, k: PokemonKey): IconResolved | null {
  const { index, layout } = ctx;
  const key = mapKey(k);

  // 1. Mapa manual del usuario.
  const mapped = lookup(ctx.map, k.egg ? "pokemon.egg" : "pokemon.icon", key);
  const mappedEntry = mapped ? index.byPath(mapped) : undefined;
  if (mappedEntry) return icon(mappedEntry, "map");

  // 2. Huevo.
  if (k.egg) {
    const sp = String(k.species).toLowerCase();
    const hit = firstHit(index, [layout.eggs], [`${sp}_icon`, "000_icon"]);
    if (hit) return icon(hit.entry, hit.nameIndex === 0 ? "exact" : "generic");
    const egg = firstHit(index, [layout.pokemonIcons], ["egg"]);
    return egg ? icon(egg.entry, "generic") : null;
  }

  if (!layout.pokemonIcons) return null;

  // 3. Convencion de nombres.
  if (layout.numbered) {
    const names = legacyNames(k);
    const hit = firstHit(index, [layout.pokemonIcons], names);
    return hit ? icon(hit.entry, hit.nameIndex === 0 ? "exact" : "fallback") : null;
  }
  const names = iconNameCandidates(k);
  // Dentro de la carpeta de variocolor se prueban TODOS los nombres antes de caer a la normal.
  const dirs = k.shiny ? [layout.pokemonIconsShiny, layout.pokemonIcons] : [layout.pokemonIcons];
  const hit = firstHit(index, dirs, names);
  if (hit) {
    const exactDir = dirs[0] === hit.entry.dir || !k.shiny || !layout.pokemonIconsShiny;
    return icon(hit.entry, hit.nameIndex === 0 && exactDir ? "exact" : "fallback");
  }

  // 4. Aproximado (solo si es inequivoco): "Pikachu_Cap" vs "PIKACHU"... nunca ambiguo.
  const pool = index.list(layout.pokemonIcons);
  const near = uniqueBestMatch(names[0], pool, (e) => e.name, 0.85);
  if (near) return icon(near, "fuzzy");

  // 5. Imagen generica del propio juego.
  const generic = firstHit(index, [layout.pokemonIcons], ["000"]);
  return generic ? icon(generic.entry, "generic") : null;
}
