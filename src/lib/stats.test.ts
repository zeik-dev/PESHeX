import { describe, expect, it } from "vitest";
import { STAT_IDS } from "../api/types";
import { NATURE_EFFECTS, baseStatTotal, calcAllStats, calcHp, calcStat, natureMultiplier, statBreakdown, statBreakdowns } from "./stats";
import { NATURE_IDS } from "./pokemon";
import { hiddenPower } from "./hiddenPower";

describe("calculo de estadisticas (port de Tables)", () => {
  it("coincide con los casos de la prueba de Ruby", () => {
    expect(calcHp(100, 50, 31, 252)).toBe(207);
    expect(calcStat(100, 50, 31, 252, 100)).toBe(152);
    expect(calcStat(100, 50, 31, 252, 110)).toBe(167);
    expect(calcStat(100, 50, 31, 252, 90)).toBe(136);
    expect(calcHp(1, 100, 31, 252)).toBe(1); // Shedinja
  });

  it("aplica la naturaleza al stat que sube y al que baja", () => {
    const adamant = { up: "ATTACK", down: "SPECIAL_ATTACK" };
    expect(natureMultiplier(adamant, "ATTACK")).toBe(110);
    expect(natureMultiplier(adamant, "SPECIAL_ATTACK")).toBe(90);
    expect(natureMultiplier(adamant, "SPEED")).toBe(100);
    expect(natureMultiplier(null, "ATTACK")).toBe(100);
    const base = { HP: 100, ATTACK: 100, DEFENSE: 100, SPECIAL_ATTACK: 100, SPECIAL_DEFENSE: 100, SPEED: 100 };
    const iv = { HP: 31, ATTACK: 31, DEFENSE: 31, SPECIAL_ATTACK: 31, SPECIAL_DEFENSE: 31, SPEED: 31 };
    const ev = { HP: 252, ATTACK: 252, DEFENSE: 0, SPECIAL_ATTACK: 0, SPECIAL_DEFENSE: 0, SPEED: 0 };
    const stats = calcAllStats(base, 50, iv, ev, adamant);
    expect(stats.HP).toBe(207);
    expect(stats.ATTACK).toBe(167);
    expect(stats.SPECIAL_ATTACK).toBe(calcStat(100, 50, 31, 0, 90));
  });

  it("los valores que faltan cuentan como 0", () => {
    const stats = calcAllStats({ HP: 50 }, 10, {}, {});
    expect(stats.HP).toBe(calcHp(50, 10, 0, 0));
    expect(baseStatTotal({ HP: 45, ATTACK: 49, DEFENSE: 49, SPECIAL_ATTACK: 65, SPECIAL_DEFENSE: 65, SPEED: 45 })).toBe(318);
  });
});

describe("descomposicion de los stats (base / IV / EV / naturaleza)", () => {
  it("el ejemplo conocido: base 100, nivel 50, IV 31, EV 252, naturaleza que sube", () => {
    expect(statBreakdown("ATTACK", 100, 50, 31, 252, 110)).toEqual({ base: 105, iv: 15, ev: 32, nature: 15, total: 167, multiplier: 110 });
    expect(statBreakdown("HP", 100, 50, 31, 252)).toEqual({ base: 160, iv: 15, ev: 32, nature: 0, total: 207, multiplier: 100 });
    expect(statBreakdown("DEFENSE", 100, 50, 31, 252, 90).nature).toBeLessThan(0);
  });

  it("la suma de las partes es SIEMPRE el total de calcStat / calcHp (barrido)", () => {
    for (const base of [1, 5, 45, 100, 130, 255]) {
      for (const level of [1, 5, 36, 50, 99, 100]) {
        for (const iv of [0, 7, 31]) {
          for (const ev of [0, 4, 100, 252]) {
            for (const mult of [90, 100, 110]) {
              const a = statBreakdown("SPEED", base, level, iv, ev, mult);
              expect(a.base + a.iv + a.ev + a.nature).toBe(a.total);
              expect(a.total).toBe(calcStat(base, level, iv, ev, mult));
              const h = statBreakdown("HP", base, level, iv, ev, mult);
              expect(h.base + h.iv + h.ev + h.nature).toBe(h.total);
              expect(h.total).toBe(calcHp(base, level, iv, ev));
              expect(h.nature).toBe(0);
            }
          }
        }
      }
    }
  });

  it("Shedinja tiene 1 PS y los 6 stats a la vez coinciden con calcAllStats", () => {
    expect(statBreakdown("HP", 1, 100, 31, 252).total).toBe(1);
    const base = { HP: 70, ATTACK: 110, DEFENSE: 80, SPECIAL_ATTACK: 55, SPECIAL_DEFENSE: 65, SPEED: 95 };
    const iv = { HP: 31, ATTACK: 30, DEFENSE: 12, SPECIAL_ATTACK: 0, SPECIAL_DEFENSE: 31, SPEED: 31 };
    const ev = { HP: 4, ATTACK: 252, DEFENSE: 0, SPECIAL_ATTACK: 0, SPECIAL_DEFENSE: 6, SPEED: 252 };
    const nat = NATURE_EFFECTS.JOLLY;
    const totals = calcAllStats(base, 63, iv, ev, nat);
    const parts = statBreakdowns(base, 63, iv, ev, nat);
    for (const s of STAT_IDS) expect(parts[s].total).toBe(totals[s]);
  });
});

describe("tabla de naturalezas", () => {
  it("tiene las 25 y cinco neutras; el orden es el del motor", () => {
    expect(Object.keys(NATURE_EFFECTS)).toEqual([...NATURE_IDS]);
    expect(Object.values(NATURE_EFFECTS).filter((n) => !n.up)).toHaveLength(5);
    expect(NATURE_EFFECTS.ADAMANT).toEqual({ up: "ATTACK", down: "SPECIAL_ATTACK" });
    expect(NATURE_EFFECTS.TIMID).toEqual({ up: "SPEED", down: "ATTACK" });
  });
});

describe("Poder oculto", () => {
  const all = (n: number) => ({ HP: n, ATTACK: n, DEFENSE: n, SPECIAL_ATTACK: n, SPECIAL_DEFENSE: n, SPEED: n });

  it("IV 31 en todo = Oscuro (el ultimo tipo) y 0 en todo = Lucha (el primero)", () => {
    expect(hiddenPower(all(31))).toEqual({ type: "DARK", power: 60 });
    expect(hiddenPower(all(0))).toEqual({ type: "FIGHTING", power: 60 });
  });

  it("solo importa el bit menos significativo", () => {
    expect(hiddenPower(all(30))?.type).toBe("FIGHTING");
    expect(hiddenPower({ ...all(30), HP: 31 })?.type).toBe("FIGHTING"); // 1*15/63 = 0
    // HP, Atq y Vel impares: bits 1 + 2 + 8 = 11 -> 15*11/63 = 2 -> Veneno
    expect(hiddenPower({ HP: 31, ATTACK: 31, DEFENSE: 30, SPEED: 31, SPECIAL_ATTACK: 30, SPECIAL_DEFENSE: 30 })?.type).toBe("POISON");
  });

  it("la potencia antigua (<= v18) sale del segundo bit de cada IV", () => {
    expect(hiddenPower(all(31), true)?.power).toBe(70);
    expect(hiddenPower(all(0), true)?.power).toBe(30);
    expect(hiddenPower(all(2), true)?.power).toBe(70);
  });

  it("sin todos los IV no hay Poder oculto", () => {
    expect(hiddenPower({ HP: 31 })).toBeNull();
    expect(hiddenPower({ ...all(31), SPEED: null })).toBeNull();
  });
});
