import { STAT_IDS, type StatId } from "../api/types";

/** Naturaleza para el calculo: el stat que sube y el que baja (`null` = neutra). */
export interface NatureEffect {
  up: string | null;
  down: string | null;
}

type StatValues = Partial<Record<StatId, number | null>>;

/** Port de `Sem::GameData::Tables` (aritmetica entera del motor de Essentials). */
export function calcHp(base: number, level: number, iv: number, ev: number): number {
  if (base === 1) return 1; // Shedinja
  return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
}

export function natureMultiplier(nature: NatureEffect | null | undefined, stat: StatId): 90 | 100 | 110 {
  if (!nature) return 100;
  if (nature.up === stat) return 110;
  if (nature.down === stat) return 90;
  return 100;
}

export function calcStat(base: number, level: number, iv: number, ev: number, multiplier: number): number {
  return Math.floor((Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * multiplier / 100);
}

/** Estadisticas totales a partir de base/IV/EV/nivel/naturaleza (la efectiva: la de menta si la hay). */
export function calcAllStats(
  base: StatValues,
  level: number,
  iv: StatValues,
  ev: StatValues,
  nature?: NatureEffect | null,
): Record<StatId, number> {
  const out = {} as Record<StatId, number>;
  for (const s of STAT_IDS) {
    const b = base[s] ?? 0;
    const i = iv[s] ?? 0;
    const e = ev[s] ?? 0;
    out[s] = s === "HP" ? calcHp(b, level, i, e) : calcStat(b, level, i, e, natureMultiplier(nature, s));
  }
  return out;
}

/** Suma de las estadisticas base (BST). */
export function baseStatTotal(base: StatValues): number {
  return STAT_IDS.reduce((sum, s) => sum + (base[s] ?? 0), 0);
}
