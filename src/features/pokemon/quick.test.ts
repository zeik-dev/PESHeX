import { describe, expect, it } from "vitest";
import { STAT_IDS, type StatId } from "../../api/types";
import { EV_PRESETS, evPresetOps, evPresetValues, healOps, perfectIvOps, suggestEvPreset } from "./quick";

const limits = { evStatMax: 252, evTotalMax: 510, ivMax: 31 } as never;
const base = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number) =>
  ({ HP: hp, ATTACK: atk, DEFENSE: def, SPECIAL_ATTACK: spa, SPECIAL_DEFENSE: spd, SPEED: spe }) as Record<StatId, number>;

describe("presets de EV", () => {
  it("cada preset reparte 252/252/4 y cabe en los limites", () => {
    expect(evPresetValues("physical", limits)).toEqual({ HP: 4, ATTACK: 252, DEFENSE: 0, SPECIAL_ATTACK: 0, SPECIAL_DEFENSE: 0, SPEED: 252 });
    expect(evPresetValues("special", limits)).toEqual({ HP: 4, ATTACK: 0, DEFENSE: 0, SPECIAL_ATTACK: 252, SPECIAL_DEFENSE: 0, SPEED: 252 });
    expect(evPresetValues("bulkyPhysical", limits)).toEqual({ HP: 252, ATTACK: 252, DEFENSE: 4, SPECIAL_ATTACK: 0, SPECIAL_DEFENSE: 0, SPEED: 0 });
    expect(evPresetValues("bulkySpecial", limits)).toEqual({ HP: 252, ATTACK: 0, DEFENSE: 0, SPECIAL_ATTACK: 252, SPECIAL_DEFENSE: 4, SPEED: 0 });
    expect(evPresetValues("tankDefense", limits)).toEqual({ HP: 252, ATTACK: 0, DEFENSE: 252, SPECIAL_ATTACK: 0, SPECIAL_DEFENSE: 4, SPEED: 0 });
    expect(evPresetValues("tankSpDefense", limits)).toEqual({ HP: 252, ATTACK: 0, DEFENSE: 4, SPECIAL_ATTACK: 0, SPECIAL_DEFENSE: 252, SPEED: 0 });
    expect(evPresetValues("none", limits)).toEqual({ HP: 0, ATTACK: 0, DEFENSE: 0, SPECIAL_ATTACK: 0, SPECIAL_DEFENSE: 0, SPEED: 0 });
    for (const p of EV_PRESETS) {
      const v = evPresetValues(p, limits);
      expect(Object.values(v).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(510);
      expect(Math.max(...Object.values(v))).toBeLessThanOrEqual(252);
    }
  });

  it("respeta un maximo por estadistica y un total menores (bases antiguas o personalizadas)", () => {
    for (const p of EV_PRESETS) {
      const v = evPresetValues(p, { evStatMax: 100, evTotalMax: 150 });
      expect(Object.values(v).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(150);
      expect(Math.max(...Object.values(v))).toBeLessThanOrEqual(100);
    }
    const v = evPresetValues("tankDefense", { evStatMax: 100, evTotalMax: 150 });
    expect(v.HP).toBe(100);
    expect(v.DEFENSE).toBe(50);
  });
});

describe("suggestEvPreset: el preset sale de los dos stats mas altos", () => {
  const cases: [string, Record<StatId, number>, string, StatId[]][] = [
    ["rapido y fisico (tipo Weavile)", base(70, 120, 65, 45, 85, 125), "physical", ["SPEED", "ATTACK"]],
    ["rapido y especial (tipo Alakazam)", base(55, 50, 45, 135, 95, 120), "special", ["SPECIAL_ATTACK", "SPEED"]],
    ["PS y ataque (tipo Garchomp: su PS supera a su velocidad)", base(108, 130, 95, 80, 85, 102), "bulkyPhysical", ["ATTACK", "HP"]],
    ["PS y ataque especial", base(95, 70, 73, 95, 90, 60), "bulkySpecial", ["HP", "SPECIAL_ATTACK"]],
    ["muro defensivo (tipo Ferrothorn)", base(74, 94, 131, 54, 116, 20), "tankDefense", ["DEFENSE", "SPECIAL_DEFENSE"]],
    ["PS y defensa especial (tipo Blissey)", base(255, 10, 10, 75, 135, 55), "tankSpDefense", ["HP", "SPECIAL_DEFENSE"]],
    ["PS y defensa", base(95, 60, 130, 60, 70, 40), "tankDefense", ["DEFENSE", "HP"]],
    ["ataque y defensa sin PS ni velocidad (tipo Tyranitar)", base(100, 134, 110, 95, 100, 61), "bulkyPhysical", ["ATTACK", "DEFENSE"]],
    ["ataque especial y defensa especial", base(80, 50, 60, 120, 110, 40), "bulkySpecial", ["SPECIAL_ATTACK", "SPECIAL_DEFENSE"]],
    ["PS y velocidad: pega con su mejor ataque", base(100, 50, 50, 60, 50, 90), "special", ["HP", "SPEED"]],
  ];

  for (const [name, stats, preset, top] of cases) {
    it(name, () => {
      const s = suggestEvPreset(stats);
      expect(s?.preset).toBe(preset);
      expect([...(s?.top ?? [])].sort()).toEqual([...top].sort());
    });
  }

  it("desempata por el orden PS, Ataque, Defensa, At. Esp., Def. Esp. y Velocidad", () => {
    // PS 160, Ataque 110 y Def. Esp. 110 empatan: gana Ataque
    expect(suggestEvPreset(base(160, 110, 65, 65, 110, 30))?.preset).toBe("bulkyPhysical");
    // Defensa y Def. Esp. empatan (tipo Shuckle): tank de Defensa
    expect(suggestEvPreset(base(20, 10, 230, 10, 230, 5))?.preset).toBe("tankDefense");
  });

  it("sin datos completos no sugiere nada", () => {
    expect(suggestEvPreset({})).toBeNull();
    expect(suggestEvPreset({ ...base(1, 2, 3, 4, 5, 6), SPEED: null })).toBeNull();
    expect(suggestEvPreset({ ...base(1, 2, 3, 4, 5, 6), HP: Number.NaN })).toBeNull();
  });

  it("siempre devuelve uno de los presets definidos", () => {
    for (let i = 0; i < 200; i++) {
      const stats = Object.fromEntries(STAT_IDS.map((s) => [s, 1 + Math.floor(((i * 7919 + STAT_IDS.indexOf(s) * 104729) % 255))])) as Record<StatId, number>;
      const s = suggestEvPreset(stats);
      expect(s && EV_PRESETS.includes(s.preset)).toBe(true);
      expect(s?.preset).not.toBe("none");
    }
  });
});

describe("acciones rapidas", () => {
  it("construye las ops en una lista (una transaccion)", () => {
    expect(healOps(["party/0", "party/1"])).toEqual([{ op: "pokemon.heal", ref: "party/0" }, { op: "pokemon.heal", ref: "party/1" }]);
    const [iv] = perfectIvOps({ ref: "party/0", limits });
    expect(iv).toMatchObject({ op: "pokemon.patch", ref: "party/0", patch: { iv: { HP: 31, SPEED: 31 } } });
    const [ev] = evPresetOps({ ref: "box/0/1", limits }, "special");
    expect(ev).toMatchObject({ patch: { ev: { SPECIAL_ATTACK: 252, SPEED: 252, HP: 4 } } });
  });
});
