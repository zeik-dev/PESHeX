import { describe, expect, it } from "vitest";
import { AssetIndex } from "./assetIndex";
import { emptyMap, withMapping } from "./assetmap";
import { detectLayout } from "./layout";
import { boxGeometry, resolveBoxBackground, BOX_BITMAP } from "./resolve/box";
import type { ResolveCtx } from "./resolve/common";
import { frameInfo } from "./resolve/common";
import { itemNameCandidates, resolveBallIcon, resolveHeldItemIcon, resolveItemIcon } from "./resolve/item";
import { resolveCategorySheet } from "./resolve/category";
import { resolveTypeSheet } from "./resolve/type";
import { iconNameCandidates, mapKey, resolvePokemonIcon } from "./resolve/pokemon";
import type { ScanFile } from "./types";

const strip = (p: string, w = 128, h = 64): ScanFile => [p, w, h];

const MODERN: ScanFile[] = [
  strip("Graphics/Pokemon/Icons/BULBASAUR.png"),
  strip("Graphics/Pokemon/Icons/BULBASAUR_1.png"),
  strip("Graphics/Pokemon/Icons/PIKACHU.png"),
  strip("Graphics/Pokemon/Icons/PIKACHU_female.png"),
  strip("Graphics/Pokemon/Icons/GENGAR_shadow.png"),
  strip("Graphics/Pokemon/Icons/GENGAR.png"),
  strip("Graphics/Pokemon/Icons/FAKEMONALPHA.png"),
  strip("Graphics/Pokemon/Icons/000.png"),
  strip("Graphics/Pokemon/Icons shiny/PIKACHU.png"),
  strip("Graphics/Pokemon/Eggs/BULBASAUR_icon.png", 128, 64),
  strip("Graphics/Pokemon/Eggs/000_icon.png", 128, 64),
  ["Graphics/Items/POTION.png", 48, 48],
  ["Graphics/Items/machine_FIRE.png", 48, 48],
  ["Graphics/Items/machine_hm_WATER.png", 48, 48],
  ["Graphics/Items/machine.png", 48, 48],
  ["Graphics/Items/000.png", 48, 48],
  ["Graphics/UI/Summary/icon_ball_POKEBALL.png", 24, 24],
  ["Graphics/UI/Party/icon_item.png", 16, 16],
  ["Graphics/UI/Storage/box_0.png", 324, 296],
  ["Graphics/UI/Storage/box_3.png", 324, 296],
];

function ctxOf(files: ScanFile[], map = null as ResolveCtx["map"]): ResolveCtx {
  const index = new AssetIndex(files);
  return { index, layout: detectLayout(index), map };
}

describe("AssetIndex", () => {
  it("busca sin distinguir mayusculas ni extension", () => {
    const idx = new AssetIndex(MODERN);
    expect(idx.get("graphics/pokemon/icons", "Bulbasaur")?.path).toBe("Graphics/Pokemon/Icons/BULBASAUR.png");
    expect(idx.byPath("graphics/items/potion.PNG")?.w).toBe(48);
    expect(idx.hasDir("Graphics/Pokemon/Icons shiny")).toBe(true);
    expect(idx.get("graphics/pokemon/icons", "nope")).toBeUndefined();
  });
});

describe("detectLayout", () => {
  it("reconoce la estructura moderna", () => {
    const l = detectLayout(new AssetIndex(MODERN));
    expect(l.family).toBe("modern");
    expect(l.pokemonIcons).toBe("graphics/pokemon/icons");
    expect(l.pokemonIconsShiny).toBe("graphics/pokemon/icons shiny");
    expect(l.boxes).toContain("graphics/ui/storage");
    expect(l.numbered).toBe(false);
  });
  it("reconoce la estructura antigua numerada", () => {
    const l = detectLayout(new AssetIndex([["Graphics/Icons/icon001.png", 128, 64], ["Graphics/Icons/item001.png", 24, 24]]));
    expect(l.family).toBe("legacy");
    expect(l.numbered).toBe(true);
    expect(l.items).toBe("graphics/icons");
  });
  it("sin Graphics conocido es unknown", () => {
    expect(detectLayout(new AssetIndex([])).family).toBe("unknown");
  });
});

describe("resolvePokemonIcon", () => {
  const ctx = ctxOf(MODERN);

  it("nombre exacto y recorte de la tira de 2 cuadros", () => {
    const r = resolvePokemonIcon(ctx, { species: "BULBASAUR" })!;
    expect(r.path).toBe("Graphics/Pokemon/Icons/BULBASAUR.png");
    expect(r.via).toBe("exact");
    expect(r.frames).toBe(2);
    expect(r.frameW).toBe(64);
  });
  it("forma > especie base", () => {
    expect(resolvePokemonIcon(ctx, { species: "BULBASAUR", form: 1 })!.path).toMatch(/BULBASAUR_1\.png$/);
    const r = resolvePokemonIcon(ctx, { species: "PIKACHU", form: 2 })!;
    expect(r.path).toMatch(/PIKACHU\.png$/);
    expect(r.via).toBe("fallback");
  });
  it("hembra y sombra cuando existen, y cae al base cuando no", () => {
    expect(resolvePokemonIcon(ctx, { species: "PIKACHU", gender: 1 })!.path).toMatch(/PIKACHU_female/);
    expect(resolvePokemonIcon(ctx, { species: "GENGAR", shadow: true })!.path).toMatch(/GENGAR_shadow/);
    expect(resolvePokemonIcon(ctx, { species: "GENGAR", gender: 1 })!.path).toMatch(/GENGAR\.png$/);
  });
  it("variocolor usa su carpeta y si falta, la normal", () => {
    expect(resolvePokemonIcon(ctx, { species: "PIKACHU", shiny: true })!.path).toContain("Icons shiny");
    const r = resolvePokemonIcon(ctx, { species: "BULBASAUR", shiny: true })!;
    expect(r.path).toBe("Graphics/Pokemon/Icons/BULBASAUR.png");
    expect(r.via).toBe("fallback");
  });
  it("huevo", () => {
    expect(resolvePokemonIcon(ctx, { species: "BULBASAUR", egg: true })!.path).toMatch(/BULBASAUR_icon/);
    const g = resolvePokemonIcon(ctx, { species: "MEW", egg: true })!;
    expect(g.path).toMatch(/000_icon/);
    expect(g.via).toBe("generic");
  });
  it("una especie sin archivo cae a la imagen generica 000 (y se marca como tal)", () => {
    const r = resolvePokemonIcon(ctx, { species: "MEWTWO" })!;
    expect(r.via).toBe("generic");
    expect(r.path).toMatch(/000\.png$/);
  });
  it("sin imagen generica devuelve null", () => {
    expect(resolvePokemonIcon(ctxOf([strip("Graphics/Pokemon/Icons/PIKACHU.png")]), { species: "MEW" })).toBeNull();
  });
  it("aproximado solo si es inequivoco", () => {
    const c = ctxOf([strip("Graphics/Pokemon/Icons/FAKEMONALPHA.png"), strip("Graphics/Pokemon/Icons/PIKACHU.png")]);
    expect(resolvePokemonIcon(c, { species: "FAKEMONALPHAA" })!.via).toBe("fuzzy");
    const ambiguous = ctxOf([strip("Graphics/Pokemon/Icons/FAKEMON2.png"), strip("Graphics/Pokemon/Icons/FAKEMON3.png")]);
    expect(resolvePokemonIcon(ambiguous, { species: "FAKEMON1" })).toBeNull();
  });
  it("el mapa manual manda sobre la convencion", () => {
    const map = withMapping(emptyMap(), "pokemon.icon", "PIKACHU", "Graphics/Pokemon/Icons/GENGAR.png");
    const r = resolvePokemonIcon(ctxOf(MODERN, map), { species: "PIKACHU" })!;
    expect(r.via).toBe("map");
    expect(r.path).toMatch(/GENGAR\.png$/);
  });
  it("un mapa que apunta a un archivo inexistente se ignora", () => {
    const map = withMapping(emptyMap(), "pokemon.icon", "PIKACHU", "Graphics/NoExiste.png");
    expect(resolvePokemonIcon(ctxOf(MODERN, map), { species: "PIKACHU" })!.via).toBe("exact");
  });
  it("bases antiguas: icon%03d con sufijos", () => {
    const c = ctxOf([strip("Graphics/Icons/icon025.png"), strip("Graphics/Icons/icon025f.png"), strip("Graphics/Icons/icon025s.png")]);
    expect(resolvePokemonIcon(c, { species: 25 })!.path).toMatch(/icon025\.png$/);
    expect(resolvePokemonIcon(c, { species: 25, gender: 1 })!.path).toMatch(/icon025f\.png$/);
    expect(resolvePokemonIcon(c, { species: 25, shiny: true })!.path).toMatch(/icon025s\.png$/);
    expect(resolvePokemonIcon(c, { species: 26 })).toBeNull();
  });
  it("candidatos y clave del mapa", () => {
    expect(iconNameCandidates({ species: "PIKACHU", form: 2, gender: 1, shadow: true })).toEqual([
      "pikachu_2_female_shadow", "pikachu_2_shadow", "pikachu_2_female", "pikachu_2",
      "pikachu_female_shadow", "pikachu_shadow", "pikachu_female", "pikachu",
    ]);
    expect(mapKey({ species: "PIKACHU", form: 0 })).toBe("PIKACHU");
    expect(mapKey({ species: "PIKACHU", form: 2 })).toBe("PIKACHU_2");
  });
  it("frameInfo: tira horizontal vs imagen unica", () => {
    expect(frameInfo(128, 64)).toEqual({ frames: 2, frameW: 64, frameH: 64 });
    expect(frameInfo(64, 64)).toEqual({ frames: 1, frameW: 64, frameH: 64 });
    expect(frameInfo(192, 64).frames).toBe(3);
  });
});

describe("objetos, balls y cajas", () => {
  const ctx = ctxOf(MODERN);
  it("icono de objeto, maquinas por tipo y generico", () => {
    expect(resolveItemIcon(ctx, { id: "POTION" })!.path).toMatch(/POTION\.png$/);
    expect(resolveItemIcon(ctx, { id: "TM_FLAME", machineType: "FIRE", fieldUse: 3 })!.path).toMatch(/machine_FIRE/);
    expect(resolveItemIcon(ctx, { id: "HM_SURF", machineType: "WATER", fieldUse: 4 })!.path).toMatch(/machine_hm_WATER/);
    expect(resolveItemIcon(ctx, { id: "TM_X", machineType: "ICE", fieldUse: 3 })!.path).toMatch(/machine\.png$/);
    const g = resolveItemIcon(ctx, { id: "NOEXISTE" })!;
    expect(g.via).toBe("generic");
    expect(itemNameCandidates({ id: "TR_A", machineType: "ICE", fieldUse: 5 })).toEqual(["tr_a", "machine_tr_ice", "machine"]);
  });
  it("bases antiguas: item%03d", () => {
    const c = ctxOf([["Graphics/Icons/icon001.png", 128, 64], ["Graphics/Icons/item017.png", 24, 24]]);
    expect(resolveItemIcon(c, { id: 17 })!.path).toMatch(/item017/);
    expect(resolveItemIcon(c, { id: 18 })).toBeNull();
  });
  it("ball: icono de resumen y, si falta, el del objeto", () => {
    expect(resolveBallIcon(ctx, "POKEBALL")!.path).toMatch(/icon_ball_POKEBALL/);
    expect(resolveBallIcon(ctx, "POTION")!.path).toMatch(/Items\/POTION/);
  });
  it("marca de objeto equipado", () => {
    expect(resolveHeldItemIcon(ctx)!.path).toMatch(/icon_item/);
    expect(resolveHeldItemIcon(ctxOf([]))).toBeNull();
  });
  it("fondo de caja por indice y geometria escalada", () => {
    expect(resolveBoxBackground(ctx, 3)!.path).toMatch(/box_3/);
    expect(resolveBoxBackground(ctx, 9)).toBeNull();
    const g = boxGeometry(BOX_BITMAP.w, BOX_BITMAP.h);
    expect([g.originX, g.originY, g.stepX]).toEqual([10, 30, 48]);
    const g2 = boxGeometry(BOX_BITMAP.w * 2, BOX_BITMAP.h * 2);
    expect([g2.originX, g2.stepX]).toEqual([20, 96]);
  });
});

describe("hoja de categorías de movimiento", () => {
  it("encuentra category.png (3 cuadros apilados) en Pictures (v16-v20) y en UI (v21)", () => {
    const legacy = resolveCategorySheet(ctxOf([["Graphics/Pictures/category.png", 64, 84]]));
    expect(legacy).toMatchObject({ path: "Graphics/Pictures/category.png", frameW: 64, frameH: 28 });
    const modern = resolveCategorySheet(ctxOf([["Graphics/UI/category.png", 64, 84], ["Graphics/Pictures/category.png", 32, 42]]));
    expect(modern?.path).toBe("Graphics/UI/category.png"); // UI gana a Pictures
  });

  it("sin la hoja, o con una forma que no es de 3 cuadros, devuelve null (se usan los íconos propios)", () => {
    expect(resolveCategorySheet(ctxOf(MODERN))).toBeNull();
    expect(resolveCategorySheet(ctxOf([["Graphics/Pictures/category.png", 64, 80]]))).toBeNull(); // 80 no se divide en 3
    expect(resolveCategorySheet(ctxOf([["Graphics/Pictures/category.png", 8, 84]]))).toBeNull(); // cuadros más altos que anchos
  });
});

describe("resolveTypeSheet", () => {
  it("encuentra types.png (cuadros de 64x28 apilados) en Pictures (v16-v20) y en UI (v21)", () => {
    const z = resolveTypeSheet(ctxOf([["Graphics/Pictures/types.png", 64, 672]]));
    expect(z).toMatchObject({ path: "Graphics/Pictures/types.png", frameW: 64, frameH: 28, rows: 24 });
    const modern = resolveTypeSheet(ctxOf([["Graphics/UI/types.png", 64, 532], ["Graphics/Pictures/types.png", 64, 672]]));
    expect(modern?.path).toBe("Graphics/UI/types.png");
    expect(modern?.rows).toBe(19);
  });

  it("no confunde otras hojas (pokedexTypes, types_ico) ni imagenes de otra forma", () => {
    expect(resolveTypeSheet(ctxOf([["Graphics/Pictures/pokedexTypes.png", 96, 608]]))).toBeNull();
    expect(resolveTypeSheet(ctxOf([["Graphics/Pictures/types_ico.png", 24, 532]]))).toBeNull();
    expect(resolveTypeSheet(ctxOf([["Graphics/Pictures/types.png", 64, 30]]))).toBeNull(); // un solo cuadro
    expect(resolveTypeSheet(ctxOf([["Graphics/Pictures/types.png", 64, 100]]))).toBeNull(); // el alto no es multiplo del cuadro
  });
});

describe("resolveBallIcon en bases antiguas", () => {
  const legacy = ctxOf([
    ["Graphics/Pictures/summaryball00.png", 32, 32],
    ["Graphics/Pictures/summaryball12.png", 32, 32],
    ["Graphics/Icons/icon001.png", 128, 64],
    ["Graphics/Icons/item004.png", 24, 24],
  ]);
  it("usa summaryballNN con NN = indice de $BallTypes", () => {
    expect(resolveBallIcon(legacy, "GREATBALL", 4, 12)?.path).toBe("Graphics/Pictures/summaryball12.png");
    expect(resolveBallIcon(legacy, "MASTERBALL", 1, 0)?.path).toBe("Graphics/Pictures/summaryball00.png");
  });
  it("sin indice o sin ese archivo cae al icono del objeto", () => {
    expect(resolveBallIcon(legacy, "ULTRABALL", 4, 99)?.path).toBe("Graphics/Icons/item004.png");
    expect(resolveBallIcon(legacy, "ULTRABALL", 4)?.path).toBe("Graphics/Icons/item004.png");
  });
  it("icon_ball_<id> sigue ganando cuando existe", () => {
    expect(resolveBallIcon(ctxOf(MODERN), "POKEBALL", null, 3)?.path).toBe("Graphics/UI/Summary/icon_ball_POKEBALL.png");
  });
});
