import type { StatId } from "../api/types";

/** Tipos posibles de Poder oculto, en el orden del motor (sin Normal, Hada ni Sombra). */
export const HIDDEN_POWER_TYPES = [
  "FIGHTING", "FLYING", "POISON", "GROUND", "ROCK", "BUG", "GHOST", "STEEL", "FIRE", "WATER", "GRASS", "ELECTRIC",
  "PSYCHIC", "ICE", "DRAGON", "DARK",
] as const;

export interface HiddenPower {
  type: (typeof HIDDEN_POWER_TYPES)[number];
  power: number;
}

type Ivs = Partial<Record<StatId, number | null>>;

/** Poder oculto segun los IV: el tipo sale del bit menos significativo de cada IV (HP, Atq, Def, Vel, Atq.Esp.,
 *  Def.Esp.) y la potencia es 60 desde la 6.ª generacion (Essentials v19+). Con `legacyPower` (bases <= v18) se usa
 *  la formula antigua: 30 + 40 · (segundo bit de cada IV) / 63. `null` si falta algun IV. */
export function hiddenPower(iv: Ivs, legacyPower = false): HiddenPower | null {
  const order: StatId[] = ["HP", "ATTACK", "DEFENSE", "SPEED", "SPECIAL_ATTACK", "SPECIAL_DEFENSE"];
  const values = order.map((s) => iv[s]);
  if (values.some((v) => v == null)) return null;
  const ivs = values as number[];
  const typeBits = ivs.reduce((acc, v, i) => acc | ((v & 1) << i), 0);
  const type = HIDDEN_POWER_TYPES[Math.floor((15 * typeBits) / 63)];
  let power = 60;
  if (legacyPower) {
    const powerBits = ivs.reduce((acc, v, i) => acc | (((v >> 1) & 1) << i), 0);
    power = Math.floor((powerBits * 40) / 63) + 30;
  }
  return { type, power };
}
