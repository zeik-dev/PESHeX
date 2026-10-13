import { describe, expect, it } from "vitest";
import type { SpeciesDetail } from "../../game/types";
import { buildNewPokemon, defaultMoves } from "./AddPokemonDialog";

const detail = {
  id: "PIKACHU", species: "PIKACHU", form: 0, name: "Pikachu", formName: null, types: ["ELECTRIC"],
  baseStats: {}, growthRate: "Medium", genderRatio: "Female50Percent",
  abilities: ["STATIC"], hiddenAbilities: ["LIGHTNINGROD"],
  levelMoves: [[1, "THUNDERSHOCK"], [1, "GROWL"], [5, "TAILWHIP"], [10, "THUNDERWAVE"], [13, "QUICKATTACK"], [18, "THUNDERSHOCK"], [20, "DOUBLETEAM"], [0, "WEIRD"], [-1, "HIDDEN"]],
  tutorMoves: [], eggMoves: [], evolutions: [], prevos: [], minimumLevel: 1, info: { happiness: 50 },
} as unknown as SpeciesDetail;

describe("movimientos por defecto de un Pokémon nuevo", () => {
  it("son los últimos 4 que la especie aprende hasta ese nivel", () => {
    expect(defaultMoves(detail, 14)).toEqual(["GROWL", "TAILWHIP", "THUNDERWAVE", "QUICKATTACK"].slice(-4));
    expect(defaultMoves(detail, 5)).toEqual(["THUNDERSHOCK", "GROWL", "TAILWHIP"]);
  });
  it("sin repetir (cuenta la última vez) y sin los de nivel 0 o -1", () => {
    const at25 = defaultMoves(detail, 25);
    expect(at25).toEqual(["TAILWHIP", "THUNDERWAVE", "QUICKATTACK", "THUNDERSHOCK", "DOUBLETEAM"].slice(-4));
    expect(at25).not.toContain("WEIRD");
    expect(at25).not.toContain("HIDDEN");
  });
  it("sin ficha de especie no hay movimientos", () => {
    expect(defaultMoves(undefined, 50)).toEqual([]);
  });
});

describe("datos del Pokémon nuevo", () => {
  const base = { species: "PIKACHU", form: 0, level: 14, nickname: "  ", shiny: false, maxIv: false, ivMax: 31, detail, legacy: false, maxMoves: 4 };

  it("la habilidad, la felicidad y los movimientos son los de la especie y no los de la plantilla", () => {
    const d = buildNewPokemon(base);
    expect(d.species).toBe("PIKACHU");
    expect(d.ability).toBe("STATIC");
    expect(d.abilityIndex).toBe(0);
    expect(d.happiness).toBe(50);
    expect(d.nickname).toBeNull(); // se borra el apodo de la plantilla
    expect(d.nature).toBe("HARDY");
    expect(d.moves?.map((m) => m.slot)).toEqual([0, 1, 2, 3]);
    expect(Object.values(d.ev ?? {}).every((v) => v === 0)).toBe(true);
    expect([0, 1]).toContain(d.gender);
  });

  it("IV al máximo o al azar dentro del límite", () => {
    expect(Object.values(buildNewPokemon({ ...base, maxIv: true }).iv ?? {}).every((v) => v === 31)).toBe(true);
    const rnd = buildNewPokemon({ ...base, ivMax: 15 });
    expect(Object.values(rnd.iv ?? {}).every((v) => typeof v === "number" && v >= 0 && v <= 15)).toBe(true);
  });

  it("en bases antiguas no se añade género ni índice de habilidad (se derivan del ID personal)", () => {
    const d = buildNewPokemon({ ...base, legacy: true });
    expect(d.gender).toBeUndefined();
    expect(d.abilityIndex).toBeUndefined();
    expect(d.ability).toBe("STATIC"); // el driver lo convierte en el indice de casilla
  });

  it("género fijo según el ratio", () => {
    expect(buildNewPokemon({ ...base, detail: { ...detail, genderRatio: "Genderless" } }).gender).toBe(2);
    expect(buildNewPokemon({ ...base, detail: { ...detail, genderRatio: "AlwaysMale" } }).gender).toBe(0);
    expect(buildNewPokemon({ ...base, detail: { ...detail, genderRatio: "AlwaysFemale" } }).gender).toBe(1);
  });
});
