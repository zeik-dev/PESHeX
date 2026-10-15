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

/** Las 25 naturalezas del motor (mismo orden que `Tables::NATURES`): sirve para listar el efecto de cada una aunque no haya
 *  carpeta de juego vinculada. */
export const NATURE_EFFECTS: Record<string, NatureEffect> = {
  HARDY: { up: null, down: null }, LONELY: { up: "ATTACK", down: "DEFENSE" }, BRAVE: { up: "ATTACK", down: "SPEED" },
  ADAMANT: { up: "ATTACK", down: "SPECIAL_ATTACK" }, NAUGHTY: { up: "ATTACK", down: "SPECIAL_DEFENSE" },
  BOLD: { up: "DEFENSE", down: "ATTACK" }, DOCILE: { up: null, down: null }, RELAXED: { up: "DEFENSE", down: "SPEED" },
  IMPISH: { up: "DEFENSE", down: "SPECIAL_ATTACK" }, LAX: { up: "DEFENSE", down: "SPECIAL_DEFENSE" },
  TIMID: { up: "SPEED", down: "ATTACK" }, HASTY: { up: "SPEED", down: "DEFENSE" }, SERIOUS: { up: null, down: null },
  JOLLY: { up: "SPEED", down: "SPECIAL_ATTACK" }, NAIVE: { up: "SPEED", down: "SPECIAL_DEFENSE" },
  MODEST: { up: "SPECIAL_ATTACK", down: "ATTACK" }, MILD: { up: "SPECIAL_ATTACK", down: "DEFENSE" },
  QUIET: { up: "SPECIAL_ATTACK", down: "SPEED" }, BASHFUL: { up: null, down: null },
  RASH: { up: "SPECIAL_ATTACK", down: "SPECIAL_DEFENSE" }, CALM: { up: "SPECIAL_DEFENSE", down: "ATTACK" },
  GENTLE: { up: "SPECIAL_DEFENSE", down: "DEFENSE" }, SASSY: { up: "SPECIAL_DEFENSE", down: "SPEED" },
  CAREFUL: { up: "SPECIAL_DEFENSE", down: "SPECIAL_ATTACK" }, QUIRKY: { up: null, down: null },
};

/** Cuánto aporta cada factor a un stat; `base + iv + ev + nature === total`. */
export interface StatBreakdown {
  /** Lo que sale de la base de la especie y el nivel (incluye la constante +5 / +nivel+10). */
  base: number;
  iv: number;
  ev: number;
  /** Puede ser negativo (naturaleza que baja el stat). */
  nature: number;
  total: number;
  /** 90 / 100 / 110. */
  multiplier: number;
}

/** Descompone el stat total en lo que aporta la base+nivel, los IV, los EV y la naturaleza. Por diferencias de la fórmula del
 *  motor (cada paso con su `floor`), así que la suma da EXACTAMENTE el mismo total que `calcStat` / `calcHp`; el reparto entre
 *  factores depende del orden (base → IV → EV → naturaleza), como en cualquier descomposición de una fórmula con `floor`. */
export function statBreakdown(stat: StatId, base: number, level: number, iv: number, ev: number, multiplier = 100): StatBreakdown {
  if (stat === "HP" && base === 1) return { base: 1, iv: 0, ev: 0, nature: 0, total: 1, multiplier: 100 }; // Shedinja
  const constant = stat === "HP" ? level + 10 : 5;
  const part = (extra: number) => Math.floor(((2 * base + extra) * level) / 100) + constant;
  const s0 = part(0);
  const s1 = part(iv);
  const s2 = part(iv + Math.floor(ev / 4));
  const mult = stat === "HP" ? 100 : multiplier;
  const total = stat === "HP" ? s2 : Math.floor((s2 * mult) / 100);
  return { base: s0, iv: s1 - s0, ev: s2 - s1, nature: total - s2, total, multiplier: mult };
}

/** `statBreakdown` de los 6 stats a partir de los mismos datos que `calcAllStats`. */
export function statBreakdowns(
  base: StatValues,
  level: number,
  iv: StatValues,
  ev: StatValues,
  nature?: NatureEffect | null,
): Record<StatId, StatBreakdown> {
  const out = {} as Record<StatId, StatBreakdown>;
  for (const s of STAT_IDS) {
    out[s] = statBreakdown(s, base[s] ?? 0, level, iv[s] ?? 0, ev[s] ?? 0, natureMultiplier(nature, s));
  }
  return out;
}
