// Acciones rapidas sobre Pokemon: cada una es una lista de ops que se aplica en UNA transaccion
// (un solo "deshacer" las revierte). Funciones puras: se prueban sin driver.

import type { EditOp, Limits, PokemonDetail, StatId } from "../../api/types";
import { STAT_IDS } from "../../api/types";

export type EvPreset =
  | "none"
  | "physical"
  | "special"
  | "bulkyPhysical"
  | "bulkySpecial"
  | "tankDefense"
  | "tankSpDefense";

/** Reparto de cada preset (252/252/4 = 508 EV): dos estadisticas fuertes y 4 de relleno. */
const PRESET_SPREAD: Record<Exclude<EvPreset, "none">, Partial<Record<StatId, number>>> = {
  physical: { ATTACK: 252, SPEED: 252, HP: 4 },
  special: { SPECIAL_ATTACK: 252, SPEED: 252, HP: 4 },
  bulkyPhysical: { HP: 252, ATTACK: 252, DEFENSE: 4 },
  bulkySpecial: { HP: 252, SPECIAL_ATTACK: 252, SPECIAL_DEFENSE: 4 },
  tankDefense: { HP: 252, DEFENSE: 252, SPECIAL_DEFENSE: 4 },
  tankSpDefense: { HP: 252, SPECIAL_DEFENSE: 252, DEFENSE: 4 },
};

export const EV_PRESETS: EvPreset[] = [
  "none", "physical", "special", "bulkyPhysical", "bulkySpecial", "tankDefense", "tankSpDefense",
];

/** EV de un preset respetando los limites del juego (por estadistica y total). */
export function evPresetValues(preset: EvPreset, limits: Pick<Limits, "evStatMax" | "evTotalMax">): Record<StatId, number> {
  const out = Object.fromEntries(STAT_IDS.map((s) => [s, 0])) as Record<StatId, number>;
  if (preset === "none") return out;
  let budget = limits.evTotalMax;
  for (const stat of STAT_IDS) {
    const want = Math.min(PRESET_SPREAD[preset][stat] ?? 0, limits.evStatMax);
    const give = Math.max(0, Math.min(want, budget));
    out[stat] = give;
    budget -= give;
  }
  return out;
}

export type StatValues = Partial<Record<StatId, number | null | undefined>>;

export interface EvSuggestion {
  preset: Exclude<EvPreset, "none">;
  /** Las dos estadisticas mas altas (de mayor a menor) en las que se baso. */
  top: [StatId, StatId];
}

/** Preset de EV que encaja con las dos estadisticas MAS ALTAS del Pokemon (`stats` = base de la especie o,
 *  sin ella, las guardadas). Desempate por el orden PS, Ataque, Defensa, At. Esp., Def. Esp., Velocidad.
 *  `null` si faltan datos. */
export function suggestEvPreset(stats: StatValues): EvSuggestion | null {
  const entries = STAT_IDS.map((id, order) => ({ id, order, value: stats[id] }));
  if (entries.some((e) => typeof e.value !== "number" || !Number.isFinite(e.value))) return null;
  const sorted = [...entries].sort((a, b) => (b.value as number) - (a.value as number) || a.order - b.order);
  const [first, second] = sorted;
  const top: [StatId, StatId] = [first.id, second.id];
  const has = (s: StatId) => top.includes(s);
  const v = (s: StatId) => stats[s] as number;
  // El atacante (fisico o especial) mas fuerte del Pokemon: desempata hacia Ataque.
  const attacker: "ATTACK" | "SPECIAL_ATTACK" = v("ATTACK") >= v("SPECIAL_ATTACK") ? "ATTACK" : "SPECIAL_ATTACK";
  const wall: "DEFENSE" | "SPECIAL_DEFENSE" = v("DEFENSE") >= v("SPECIAL_DEFENSE") ? "DEFENSE" : "SPECIAL_DEFENSE";
  const sweeper = (a: "ATTACK" | "SPECIAL_ATTACK") => (a === "ATTACK" ? "physical" : "special") as EvSuggestion["preset"];
  const bulky = (a: "ATTACK" | "SPECIAL_ATTACK") => (a === "ATTACK" ? "bulkyPhysical" : "bulkySpecial") as EvSuggestion["preset"];
  const tank = (w: "DEFENSE" | "SPECIAL_DEFENSE") => (w === "DEFENSE" ? "tankDefense" : "tankSpDefense") as EvSuggestion["preset"];
  const topAttacker = has("ATTACK") && has("SPECIAL_ATTACK") ? attacker : has("ATTACK") ? "ATTACK" : has("SPECIAL_ATTACK") ? "SPECIAL_ATTACK" : null;
  const topWall = has("DEFENSE") && has("SPECIAL_DEFENSE") ? wall : has("DEFENSE") ? "DEFENSE" : has("SPECIAL_DEFENSE") ? "SPECIAL_DEFENSE" : null;

  let preset: EvSuggestion["preset"];
  if (has("SPEED") && topAttacker) preset = sweeper(topAttacker);
  else if (has("HP") && topAttacker) preset = bulky(topAttacker);
  else if (has("HP") && topWall) preset = tank(topWall);
  else if (topAttacker && topWall) preset = bulky(topAttacker); // p. ej. Ataque + Defensa: ataca y aguanta
  else if (has("SPEED") && topWall) preset = sweeper(attacker); // rapido y con defensa: pega con su mejor ataque
  else preset = topWall ? tank(topWall) : sweeper(attacker); // combinaciones sin sentido competitivo: cae a lo mas cercano
  return { preset, top };
}

export function healOps(refs: string[]): EditOp[] {
  return refs.map((ref) => ({ op: "pokemon.heal", ref }));
}

export function perfectIvOps(pk: Pick<PokemonDetail, "ref" | "limits">): EditOp[] {
  const iv = Object.fromEntries(STAT_IDS.map((s) => [s, pk.limits.ivMax])) as Record<StatId, number>;
  return [{ op: "pokemon.patch", ref: pk.ref, patch: { iv } }];
}

export function evPresetOps(pk: Pick<PokemonDetail, "ref" | "limits">, preset: EvPreset): EditOp[] {
  return [{ op: "pokemon.patch", ref: pk.ref, patch: { ev: evPresetValues(preset, pk.limits) } }];
}
