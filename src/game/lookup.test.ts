import { describe, expect, it } from "vitest";
import { catEntry, indexCatalog, internalId, itemDisplayName } from "./lookup";
import type { Catalog } from "./types";

const catalog: Catalog = {
  species: [
    { id: "BULBASAUR", species: "BULBASAUR", form: 0, name: "Bulbasaur", formName: null, types: ["GRASS"], number: 1 },
    { id: "BULBASAUR_1", species: "BULBASAUR", form: 1, name: "Bulbasaur", formName: "Mega", types: ["GRASS"], number: 1 },
  ],
  moves: [{ id: "BLIZZARD", number: 59, name: "Ventisca", type: "ICE", category: 1, power: 110, accuracy: 70, pp: 5 }],
  items: [
    { id: "TM01", number: 288, name: "MT01", pocket: 4, machine: true, move: "BLIZZARD", fieldUse: 3 },
    { id: "POTION", number: 217, name: "Poción", pocket: 2, machine: false, move: null, fieldUse: 1 },
  ],
  abilities: [{ id: "OVERGROW", number: 65, name: "Espesura", description: null }],
  types: [{ id: "GRASS", name: "Planta", weaknesses: ["FIRE"] }],
  natures: [],
};

describe("indices del catalogo", () => {
  const index = indexCatalog(catalog);

  it("resuelve ids internos y numericos (bases <= v18)", () => {
    expect(catEntry(index, "items", "POTION")?.name).toBe("Poción");
    expect(catEntry(index, "items", 217)?.id).toBe("POTION");
    expect(catEntry(index, "moves", 59)?.id).toBe("BLIZZARD");
    expect(catEntry(index, "abilities", 65)?.id).toBe("OVERGROW");
    expect(catEntry(index, "items", 99999)).toBeUndefined();
    expect(catEntry(index, "items", null)).toBeUndefined();
  });

  it("el numero de una especie apunta a la forma base, no a las formas", () => {
    expect(catEntry(index, "species", 1)?.id).toBe("BULBASAUR");
  });

  it("internalId devuelve el id que entienden los selectores y el driver", () => {
    expect(internalId(index, "items", 217)).toBe("POTION");
    expect(internalId(index, "items", "POTION")).toBe("POTION");
    expect(internalId(index, "items", "DESCONOCIDO")).toBe("DESCONOCIDO"); // id propio de la base
    expect(internalId(index, "items", 4242)).toBeNull();
    expect(internalId(index, "items", "")).toBeNull();
  });

  it("las MT se nombran con su movimiento", () => {
    expect(itemDisplayName(catalog.items[0], index)).toBe("MT01 · Ventisca");
    expect(itemDisplayName(catalog.items[1], index)).toBe("Poción");
    expect(itemDisplayName({ ...catalog.items[0], move: "NOEXISTE" }, index)).toBe("MT01");
  });
});
