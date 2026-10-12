// Acciones rapidas sobre Pokemon: cada una es una lista de ops que se aplica en UNA transaccion
// (un solo "deshacer" las revierte). Funciones puras: se prueban sin driver.

import type { EditOp, Limits, PokemonDetail, StatId } from "../../api/types";
import { STAT_IDS } from "../../api/types";

export type EvPreset = "none" | "physical" | "special" | "bulky";

const PRESET_SPREAD: Record<Exclude<EvPreset, "none">, Partial<Record<StatId, number>>> = {
  physical: { ATTACK: 252, SPEED: 252, HP: 4 },
  special: { SPECIAL_ATTACK: 252, SPEED: 252, HP: 4 },
  bulky: { HP: 252, DEFENSE: 252, SPECIAL_DEFENSE: 4 },
};

export const EV_PRESETS: EvPreset[] = ["none", "physical", "special", "bulky"];

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
