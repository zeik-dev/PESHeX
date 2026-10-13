import type { CatType } from "../game/types";

/** Multiplicadores que recibe un Pokémon de uno o dos tipos, agrupados (4, 2, 1/2, 1/4, 0). */
export interface Matchups {
  x4: string[];
  x2: string[];
  half: string[];
  quarter: string[];
  immune: string[];
}

/** Efectividad de cada tipo atacante contra `types` según la tabla del juego (`types.txt`: debilidades, resistencias e
 *  inmunidades de cada tipo defensor). Los tipos especiales («???», sombra) no atacan y se omiten. */
export function typeMatchups(types: readonly string[], chart: readonly CatType[]): Matchups {
  const out: Matchups = { x4: [], x2: [], half: [], quarter: [], immune: [] };
  const defenders = types.map((id) => chart.find((t) => t.id === id)).filter((t): t is CatType => !!t);
  if (defenders.length === 0) return out;
  for (const attacker of chart) {
    if (attacker.special) continue;
    let mult = 1;
    for (const d of defenders) {
      if (d.immunities?.includes(attacker.id)) mult *= 0;
      else if (d.weaknesses?.includes(attacker.id)) mult *= 2;
      else if (d.resistances?.includes(attacker.id)) mult *= 0.5;
    }
    if (mult === 0) out.immune.push(attacker.id);
    else if (mult >= 4) out.x4.push(attacker.id);
    else if (mult >= 2) out.x2.push(attacker.id);
    else if (mult <= 0.25) out.quarter.push(attacker.id);
    else if (mult <= 0.5) out.half.push(attacker.id);
  }
  return out;
}
