import type { CatAbility, CatItem, CatMove, CatSpecies, CatType, Catalog } from "./types";

/** Indices del catalogo por id interno y, para las bases <= v18 (ids enteros en el save), por numero. */
export interface CatalogIndex {
  species: Map<string, CatSpecies>;
  moves: Map<string, CatMove>;
  items: Map<string, CatItem>;
  abilities: Map<string, CatAbility>;
  types: Map<string, CatType>;
  speciesByNumber: Map<number, CatSpecies>;
  movesByNumber: Map<number, CatMove>;
  itemsByNumber: Map<number, CatItem>;
  abilitiesByNumber: Map<number, CatAbility>;
}

export type CatKind = "species" | "moves" | "items" | "abilities";

function byNumber<T extends { number?: number | null; form?: number }>(list: T[]): Map<number, T> {
  const out = new Map<number, T>();
  for (const e of list) {
    // Especies: el numero es el de la forma base (las formas lo comparten).
    if (e.number != null && !(e.form && e.form > 0) && !out.has(e.number)) out.set(e.number, e);
  }
  return out;
}

export function indexCatalog(c: Catalog): CatalogIndex {
  return {
    species: new Map(c.species.map((s) => [s.id, s])),
    moves: new Map(c.moves.map((m) => [m.id, m])),
    items: new Map(c.items.map((i) => [i.id, i])),
    abilities: new Map(c.abilities.map((a) => [a.id, a])),
    types: new Map(c.types.map((t) => [t.id, t])),
    speciesByNumber: byNumber(c.species),
    movesByNumber: byNumber(c.moves),
    itemsByNumber: byNumber(c.items),
    abilitiesByNumber: byNumber(c.abilities),
  };
}

/** Entrada del catalogo para un id del save: interno ("BULBASAUR") o numerico (59). */
export function catEntry(index: CatalogIndex | null | undefined, kind: "species", id: string | number | null | undefined): CatSpecies | undefined;
export function catEntry(index: CatalogIndex | null | undefined, kind: "moves", id: string | number | null | undefined): CatMove | undefined;
export function catEntry(index: CatalogIndex | null | undefined, kind: "items", id: string | number | null | undefined): CatItem | undefined;
export function catEntry(index: CatalogIndex | null | undefined, kind: "abilities", id: string | number | null | undefined): CatAbility | undefined;
export function catEntry(index: CatalogIndex | null | undefined, kind: CatKind, id: string | number | null | undefined) {
  if (!index || id == null || id === "") return undefined;
  if (typeof id === "number") {
    const map = { species: index.speciesByNumber, moves: index.movesByNumber, items: index.itemsByNumber, abilities: index.abilitiesByNumber }[kind];
    return map.get(id);
  }
  return index[kind].get(id);
}

/** Id interno (el que entienden los selectores y el driver) de un id del save; `null` si no se conoce. */
export function internalId(index: CatalogIndex | null | undefined, kind: CatKind, id: string | number | null | undefined): string | null {
  if (id == null || id === "") return null;
  const entry = catEntry(index, kind as "items", id);
  if (entry) return entry.id;
  return typeof id === "string" ? id : null;
}

/** Nombre a mostrar de un objeto: las MT/MO llevan su movimiento («MT01 · Ventisca»). */
export function itemDisplayName(item: CatItem, index: CatalogIndex | null | undefined, fallback?: string): string {
  const name = item.name ?? fallback ?? item.id;
  if (!item.machine || !item.move) return name;
  const move = index?.moves.get(item.move);
  const moveName = move?.name ?? null;
  return moveName ? `${name} · ${moveName}` : name;
}
