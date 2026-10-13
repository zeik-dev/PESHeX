import { describe, expect, it } from "vitest";
import { evoParamKind, groupEncounters, humanizeMethod, levelRange } from "./evolution";

describe("evolución", () => {
  it("clasifica el parámetro según el método", () => {
    expect(evoParamKind("Level", 16)).toBe("number");
    expect(evoParamKind("LevelDay", "20")).toBe("number");
    expect(evoParamKind("Item", "FIRESTONE")).toBe("item");
    expect(evoParamKind("HoldItem", "RAZORCLAW")).toBe("item");
    expect(evoParamKind("TradeItem", "METALCOAT")).toBe("item");
    expect(evoParamKind("HasMove", "ANCIENTPOWER")).toBe("move");
    expect(evoParamKind("HasMoveType", "FAIRY")).toBe("type");
    expect(evoParamKind("HasInParty", "MANTYKE")).toBe("species");
    expect(evoParamKind("HappinessDay", null)).toBe("none");
    expect(evoParamKind("Location", "12")).toBe("raw");
  });

  it("humaniza un método sin traducción", () => {
    expect(humanizeMethod("HappinessDay")).toBe("Happiness day");
    expect(humanizeMethod("TradeItem")).toBe("Trade item");
  });

  it("agrupa los encuentros por mapa y ordena por nombre", () => {
    const g = groupEncounters([
      { map: 5, name: "Ruta 2", method: "Land", min: 2, max: 4, chance: 20 },
      { map: 3, name: "Ruta 1", method: "Land", min: 3, max: 5, chance: 20 },
      { map: 5, name: null, method: "Cave", min: 6, max: 6, chance: 10 },
    ]);
    expect(g.map((x) => [x.name, x.rows.length])).toEqual([["Ruta 1", 1], ["Ruta 2", 2]]);
  });

  it("rango de niveles", () => {
    expect(levelRange(2, 4)).toBe("2–4");
    expect(levelRange(5, 5)).toBe("5");
    expect(levelRange(null, null)).toBeNull();
  });
});
