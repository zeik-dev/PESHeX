import { describe, expect, it } from "vitest";
import type { CatType } from "../game/types";
import { typeMatchups } from "./typeChart";

const chart: CatType[] = [
  { id: "NORMAL", name: "Normal", weaknesses: ["FIGHTING"], immunities: ["GHOST"] },
  { id: "FIGHTING", name: "Lucha", weaknesses: ["FLYING", "PSYCHIC"], resistances: ["ROCK", "BUG"] },
  { id: "FLYING", name: "Volador", weaknesses: ["ROCK", "ELECTRIC"], resistances: ["FIGHTING", "BUG", "GRASS"], immunities: ["GROUND"] },
  { id: "GHOST", name: "Fantasma", weaknesses: ["GHOST"], immunities: ["NORMAL", "FIGHTING"] },
  { id: "ROCK", name: "Roca" },
  { id: "BUG", name: "Bicho" },
  { id: "GRASS", name: "Planta" },
  { id: "ELECTRIC", name: "Eléctrico" },
  { id: "GROUND", name: "Tierra" },
  { id: "PSYCHIC", name: "Psíquico" },
  { id: "QMARKS", name: "???", special: true },
];

describe("typeMatchups", () => {
  it("un tipo simple: debilidades, resistencias e inmunidades", () => {
    const m = typeMatchups(["NORMAL"], chart);
    expect(m.x2).toEqual(["FIGHTING"]);
    expect(m.immune).toEqual(["GHOST"]);
    expect(m.half).toEqual([]);
  });

  it("dos tipos multiplican: x4, x1/4, y una inmunidad anula lo demás", () => {
    const m = typeMatchups(["FIGHTING", "FLYING"], chart);
    expect(m.x2).toEqual(["FLYING", "ELECTRIC", "PSYCHIC"]);
    expect(m.half).toEqual(["FIGHTING", "GRASS"]);
    expect(m.quarter).toEqual(["BUG"]);
    expect(m.immune).toEqual(["GROUND"]);
    // Roca: débil en Volador (x2) y resistida por Lucha (x1/2) => neutro.
    expect([...m.x2, ...m.half, ...m.quarter, ...m.immune]).not.toContain("ROCK");
    expect(typeMatchups(["GHOST", "GHOST"], chart).x4).toEqual(["GHOST"]);
  });

  it("omite los tipos especiales y tolera tipos desconocidos", () => {
    expect(typeMatchups(["QUE"], chart)).toEqual({ x4: [], x2: [], half: [], quarter: [], immune: [] });
    expect(typeMatchups(["NORMAL"], chart).immune).not.toContain("QMARKS");
  });
});
