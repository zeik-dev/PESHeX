// Mapa manual de assets (assetmap.json v1): lo que el usuario confirma a mano
// cuando la convencion de nombres no basta. Se guarda por juego en el directorio
// de datos de la app (nunca dentro de la carpeta del juego).

export interface AssetMap {
  version: 1;
  pokemon: { icon: Record<string, string>; egg: Record<string, string> };
  items: Record<string, string>;
  balls: Record<string, string>;
  boxes: Record<string, string>;
  /** Archivos que el usuario marco como "no es un asset de Pokémon" (no se vuelven a sugerir). */
  ignore: string[];
}

export type MapKind = "pokemon.icon" | "pokemon.egg" | "items" | "balls" | "boxes";

export function emptyMap(): AssetMap {
  return { version: 1, pokemon: { icon: {}, egg: {} }, items: {}, balls: {}, boxes: {}, ignore: [] };
}

function strRecord(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string" && val) out[k] = val;
    }
  }
  return out;
}

/** Acepta cualquier JSON (archivo editado a mano, version futura) y devuelve un mapa valido. */
export function normalizeMap(raw: unknown): AssetMap {
  const m = emptyMap();
  if (!raw || typeof raw !== "object") return m;
  const r = raw as Record<string, unknown>;
  const pk = (r.pokemon ?? {}) as Record<string, unknown>;
  m.pokemon.icon = strRecord(pk.icon);
  m.pokemon.egg = strRecord(pk.egg);
  m.items = strRecord(r.items);
  m.balls = strRecord(r.balls);
  m.boxes = strRecord(r.boxes);
  m.ignore = Array.isArray(r.ignore) ? r.ignore.filter((x): x is string => typeof x === "string") : [];
  return m;
}

function bucket(m: AssetMap, kind: MapKind): Record<string, string> {
  switch (kind) {
    case "pokemon.icon": return m.pokemon.icon;
    case "pokemon.egg": return m.pokemon.egg;
    case "items": return m.items;
    case "balls": return m.balls;
    case "boxes": return m.boxes;
  }
}

/** Devuelve una copia con `key -> path` asignado (o quitado si path es null). */
export function withMapping(map: AssetMap, kind: MapKind, key: string, path: string | null): AssetMap {
  const next = normalizeMap(JSON.parse(JSON.stringify(map)));
  const b = bucket(next, kind);
  if (path === null) delete b[key];
  else b[key] = path;
  return next;
}

export function withIgnored(map: AssetMap, path: string, ignored: boolean): AssetMap {
  const next = normalizeMap(JSON.parse(JSON.stringify(map)));
  next.ignore = ignored ? [...new Set([...next.ignore, path])] : next.ignore.filter((p) => p !== path);
  return next;
}

export function lookup(map: AssetMap | null | undefined, kind: MapKind, key: string): string | undefined {
  return map ? bucket(map, kind)[key] : undefined;
}
