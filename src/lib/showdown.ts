// Importar/exportar Pokemon: texto estilo Pokemon Showdown y JSON `peshex.pokemon/1`.
// El texto se interpreta aqui (el driver solo recibe campos ya resueltos a IDs del juego).

import type { PokemonImport, StatId } from "../api/types";
import { norm } from "../game/normalize";

export const SCHEMA = "peshex.pokemon/1";

const STAT_TOKEN: Record<string, StatId> = {
  hp: "HP", atk: "ATTACK", attack: "ATTACK", def: "DEFENSE", defense: "DEFENSE",
  spa: "SPECIAL_ATTACK", spatk: "SPECIAL_ATTACK", spc: "SPECIAL_ATTACK", "sp. atk": "SPECIAL_ATTACK",
  spd: "SPECIAL_DEFENSE", spdef: "SPECIAL_DEFENSE", "sp. def": "SPECIAL_DEFENSE",
  spe: "SPEED", speed: "SPEED",
};

export interface ShowdownSet {
  species: string;
  nickname?: string;
  /** 0 = macho, 1 = hembra */
  gender?: 0 | 1;
  item?: string;
  ability?: string;
  level?: number;
  shiny?: boolean;
  happiness?: number;
  nature?: string;
  ev: Partial<Record<StatId, number>>;
  iv: Partial<Record<StatId, number>>;
  moves: string[];
}

function parseStatLine(text: string): Partial<Record<StatId, number>> {
  const out: Partial<Record<StatId, number>> = {};
  for (const part of text.split("/")) {
    const m = /^\s*(\d+)\s+([A-Za-z. ]+?)\s*$/.exec(part);
    const stat = m ? STAT_TOKEN[m[2].toLowerCase()] : undefined;
    if (m && stat) out[stat] = Number(m[1]);
  }
  return out;
}

function parseHead(line: string): Pick<ShowdownSet, "species" | "nickname" | "gender" | "item"> {
  let rest = line.trim();
  let item: string | undefined;
  const at = rest.lastIndexOf(" @ ");
  if (at >= 0) {
    item = rest.slice(at + 3).trim() || undefined;
    rest = rest.slice(0, at).trim();
  }
  let gender: 0 | 1 | undefined;
  const g = /\s*\(([MF])\)\s*$/.exec(rest);
  if (g) {
    gender = g[1] === "M" ? 0 : 1;
    rest = rest.slice(0, g.index).trim();
  }
  let nickname: string | undefined;
  const nick = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(rest);
  if (nick && nick[1]) {
    nickname = nick[1].trim();
    rest = nick[2].trim();
  }
  return { species: rest, nickname, gender, item };
}

/** Interpreta uno o varios sets separados por lineas en blanco. Ignora lineas que no entiende. */
export function parseShowdown(text: string): ShowdownSet[] {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const sets: ShowdownSet[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0 || lines[0].startsWith("-")) continue;
    const head = parseHead(lines[0]);
    if (!head.species) continue;
    const set: ShowdownSet = { ...head, ev: {}, iv: {}, moves: [] };
    for (const line of lines.slice(1)) {
      if (line.startsWith("-")) {
        const mv = line.replace(/^-+\s*/, "").trim();
        if (mv) set.moves.push(mv);
        continue;
      }
      const nature = /^([A-Za-z]+)\s+Nature$/i.exec(line);
      if (nature) {
        set.nature = nature[1];
        continue;
      }
      const kv = /^([A-Za-z ]+):\s*(.*)$/.exec(line);
      if (!kv) continue;
      const value = kv[2].trim();
      switch (kv[1].trim().toLowerCase()) {
        case "ability": set.ability = value; break;
        case "level": if (/^\d+$/.test(value)) set.level = Number(value); break;
        case "shiny": set.shiny = /^(yes|true|1)$/i.test(value); break;
        case "happiness": if (/^\d+$/.test(value)) set.happiness = Number(value); break;
        case "evs": set.ev = parseStatLine(value); break;
        case "ivs": set.iv = parseStatLine(value); break;
        default: break;
      }
    }
    sets.push(set);
  }
  return sets;
}

/** Busca el ID del juego para un nombre; `null` = el catalogo existe y no lo conoce. */
export interface NameResolver {
  species(name: string): string | null;
  item(name: string): string | null;
  ability(name: string): string | null;
  move(name: string): string | null;
}

/** Sin catalogo: el nombre normalizado ("Fire Blast" -> "FIREBLAST") es el ID habitual de Essentials. */
export const GUESS_RESOLVER: NameResolver = {
  species: norm, item: norm, ability: norm, move: norm,
};

export function catalogResolver(c: {
  species: { id: string; name: string | null }[];
  items: { id: string; name: string | null }[];
  abilities: { id: string; name: string | null }[];
  moves: { id: string; name: string | null }[];
}): NameResolver {
  const index = (list: { id: string; name: string | null }[], preferBase = false) => {
    const m = new Map<string, string>();
    for (const e of list) {
      if (e.name) {
        const k = norm(e.name);
        // Varias formas comparten nombre: gana la forma base (la primera sin "_N").
        if (!m.has(k) || (preferBase && !/_\d+$/.test(e.id) && /_\d+$/.test(m.get(k)!))) m.set(k, e.id);
      }
    }
    for (const e of list) m.set(norm(e.id), m.get(norm(e.id)) ?? e.id);
    return m;
  };
  const sp = index(c.species, true), it = index(c.items), ab = index(c.abilities), mv = index(c.moves);
  const find = (m: Map<string, string>) => (name: string) => m.get(norm(name)) ?? null;
  return { species: find(sp), item: find(it), ability: find(ab), move: find(mv) };
}

export type ImportWarning =
  | { code: "unknown_item" | "unknown_ability" | "unknown_move" | "unknown_nature"; name: string };

export interface ResolvedSet {
  /** null si no se pudo resolver la especie. */
  data: PokemonImport | null;
  unknownSpecies?: string;
  warnings: ImportWarning[];
}

export const NATURES = [
  "HARDY", "LONELY", "BRAVE", "ADAMANT", "NAUGHTY", "BOLD", "DOCILE", "RELAXED", "IMPISH", "LAX",
  "TIMID", "HASTY", "SERIOUS", "JOLLY", "NAIVE", "MODEST", "MILD", "QUIET", "BASHFUL", "RASH",
  "CALM", "GENTLE", "SASSY", "CAREFUL", "QUIRKY",
];

export function resolveSet(set: ShowdownSet, r: NameResolver, maxMoves = 4): ResolvedSet {
  const warnings: ImportWarning[] = [];
  const species = r.species(set.species);
  if (!species) return { data: null, unknownSpecies: set.species, warnings };
  const data: PokemonImport = { species };
  if (set.nickname) data.nickname = set.nickname;
  if (set.level != null) data.level = set.level;
  if (set.gender != null) data.gender = set.gender;
  if (set.shiny) data.shiny = true;
  if (set.happiness != null) data.happiness = set.happiness;
  if (set.item) {
    const id = r.item(set.item);
    if (id) data.item = id; else warnings.push({ code: "unknown_item", name: set.item });
  }
  if (set.ability) {
    const id = r.ability(set.ability);
    if (id) data.ability = id; else warnings.push({ code: "unknown_ability", name: set.ability });
  }
  if (set.nature) {
    const id = norm(set.nature);
    if (NATURES.includes(id)) data.nature = id; else warnings.push({ code: "unknown_nature", name: set.nature });
  }
  if (Object.keys(set.ev).length) data.ev = set.ev;
  if (Object.keys(set.iv).length) data.iv = set.iv;
  const moves: { id: string }[] = [];
  for (const name of set.moves) {
    const id = r.move(name);
    if (id) moves.push({ id }); else warnings.push({ code: "unknown_move", name });
  }
  if (moves.length) data.moves = moves.slice(0, maxMoves).map((m, slot) => ({ slot, id: m.id }));
  return { data, warnings };
}

// ── JSON `peshex.pokemon/1` ───────────────────────────────────────────────────

const JSON_FIELDS = [
  "species", "form", "nickname", "level", "exp", "nature", "ability", "abilityIndex", "item", "ball",
  "gender", "shiny", "happiness", "hp",
] as const;

export type JsonParse = { ok: true; data: PokemonImport } | { ok: false; reason: "invalid_json" | "not_peshex" | "no_species" };

/** Valida un JSON exportado por PESHeX y lo convierte a los campos de `pokemon.add`. */
export function parsePokemonJson(text: string): JsonParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not_peshex" };
  const obj = raw as Record<string, unknown>;
  if (obj.schema !== SCHEMA) return { ok: false, reason: "not_peshex" };
  if (typeof obj.species !== "string" || obj.species === "") return { ok: false, reason: "no_species" };
  const data: Record<string, unknown> = {};
  for (const k of JSON_FIELDS) {
    const v = obj[k];
    if (v !== null && v !== undefined) data[k] = v;
  }
  for (const k of ["iv", "ev"] as const) {
    const m = obj[k];
    if (m && typeof m === "object") {
      const clean: Record<string, number> = {};
      for (const [stat, val] of Object.entries(m as Record<string, unknown>)) if (typeof val === "number") clean[stat] = val;
      if (Object.keys(clean).length) data[k] = clean;
    }
  }
  if (Array.isArray(obj.moves)) {
    data.moves = obj.moves
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof (m as Record<string, unknown>).id === "string")
      .map((m, slot) => ({ slot, id: m.id as string, ...(typeof m.pp === "number" ? { pp: m.pp } : {}), ...(typeof m.ppUps === "number" ? { ppUps: m.ppUps } : {}) }));
  }
  return { ok: true, data: data as unknown as PokemonImport };
}
