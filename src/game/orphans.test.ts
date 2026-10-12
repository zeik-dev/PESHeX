import { describe, expect, it } from "vitest";
import { AssetIndex } from "./assetIndex";
import { withIgnored, emptyMap, withMapping } from "./assetmap";
import { detectLayout } from "./layout";
import { findOrphans, referenceSprite } from "./orphans";
import type { ResolveCtx } from "./resolve/common";
import type { CatSpecies, ScanFile } from "./types";

const sp = (species: string, number: number, form = 0): CatSpecies => ({ id: form ? `${species}_${form}` : species, species, form, name: species, formName: null, types: [], number });
const strip = (p: string): ScanFile => [p, 128, 64];

const FILES: ScanFile[] = [
  strip("Graphics/Pokemon/Icons/BULBASAUR.png"),
  strip("Graphics/Pokemon/Icons/000.png"),
  strip("Graphics/Pokemon/Icons/icon_misc_01.png"),
  strip("Graphics/Pokemon/Icons/icon_misc_02.png"),
  ["Graphics/Pokemon/Front/IVYSAUR.png", 96, 96],
];

function ctx(map: ResolveCtx["map"] = null): ResolveCtx {
  const index = new AssetIndex(FILES);
  return { index, layout: detectLayout(index), map };
}

const SPECIES = [sp("BULBASAUR", 1), sp("IVYSAUR", 2), sp("VENUSAUR", 3)];

describe("findOrphans", () => {
  it("lista las especies sin icono y los archivos que nadie usa (sin contar el generico)", () => {
    const r = findOrphans(ctx(), SPECIES);
    expect(r.missing.map((m) => m.key)).toEqual(["IVYSAUR", "VENUSAUR"]);
    expect(r.orphans.map((o) => o.name)).toEqual(["icon_misc_01", "icon_misc_02"]);
  });

  it("una asignacion manual saca a la especie y al archivo de las listas", () => {
    const map = withMapping(emptyMap(), "pokemon.icon", "IVYSAUR", "Graphics/Pokemon/Icons/icon_misc_01.png");
    const r = findOrphans(ctx(map), SPECIES);
    expect(r.missing.map((m) => m.key)).toEqual(["VENUSAUR"]);
    expect(r.orphans.map((o) => o.name)).toEqual(["icon_misc_02"]);
  });

  it("los archivos marcados como ignorados no se ofrecen", () => {
    const map = withIgnored(emptyMap(), "Graphics/Pokemon/Icons/icon_misc_02.png", true);
    expect(findOrphans(ctx(map), SPECIES).orphans.map((o) => o.name)).toEqual(["icon_misc_01"]);
  });

  it("sin carpeta de iconos no hay nada que revisar", () => {
    const index = new AssetIndex([["Graphics/Items/POTION.png", 48, 48]]);
    expect(findOrphans({ index, layout: detectLayout(index), map: null }, SPECIES)).toEqual({ missing: [], orphans: [] });
  });
});

describe("referenceSprite", () => {
  it("busca el sprite de combate de la especie", () => {
    expect(referenceSprite(ctx(), { species: "IVYSAUR", number: 2 })?.path).toBe("Graphics/Pokemon/Front/IVYSAUR.png");
    expect(referenceSprite(ctx(), { species: "VENUSAUR", number: 3 })).toBeUndefined();
  });
});
