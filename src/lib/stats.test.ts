import { describe, expect, it } from "vitest";
import { baseStatTotal, calcAllStats, calcHp, calcStat, natureMultiplier } from "./stats";
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
