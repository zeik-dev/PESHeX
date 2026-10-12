import { describe, expect, it } from "vitest";
import { filterCommands, hitTarget, type PaletteCmd } from "./commands";

const cmd = (id: string, label: string, keywords?: string): PaletteCmd => ({ id, label, keywords, group: "view", run: () => undefined });

describe("filterCommands", () => {
  const all = [cmd("a", "Guardar cambios"), cmd("b", "Ir a Pokédex"), cmd("c", "Deshacer", "undo ctrl z"), cmd("d", "Ir a Mochila")];

  it("sin consulta devuelve todo en su orden", () => {
    expect(filterCommands(all, "  ").map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("ignora acentos y mayusculas y pone antes los que empiezan por la consulta", () => {
    expect(filterCommands(all, "pokedex").map((c) => c.id)).toEqual(["b"]);
    expect(filterCommands(all, "ir a").map((c) => c.id)).toEqual(["b", "d"]);
    expect(filterCommands(all, "cambios").map((c) => c.id)).toEqual(["a"]);
  });

  it("busca tambien en los sinonimos", () => {
    expect(filterCommands(all, "undo").map((c) => c.id)).toEqual(["c"]);
    expect(filterCommands(all, "zzz")).toEqual([]);
  });
});

describe("hitTarget", () => {
  it("Pokemon del equipo y del PC", () => {
    expect(hitTarget("pokemon", { ref: "party/2", label: "x" })).toEqual({ view: "party", select: "party/2" });
    expect(hitTarget("pokemon", { ref: "box/7/3", label: "x" })).toEqual({ view: "boxes", select: "box/7/3", box: 7 });
    expect(hitTarget("pokemon", { label: "x" })).toBeNull();
  });

  it("cajas, objetos y mundo", () => {
    expect(hitTarget("boxes", { index: 4, label: "Caja" })).toEqual({ view: "boxes", box: 4 });
    expect(hitTarget("boxes", { label: "Caja" })).toBeNull();
    expect(hitTarget("items", { ref: "bag/1/0", label: "Pocion" })).toEqual({ view: "bag" });
    expect(hitTarget("world", { kind: "switches", id: 5, label: "Medalla 1" })).toEqual({ view: "world", world: { kind: "switches", q: "5" } });
  });
});
