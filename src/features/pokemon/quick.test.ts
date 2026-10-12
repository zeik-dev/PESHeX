import { describe, expect, it } from "vitest";
import { evPresetOps, evPresetValues, healOps, perfectIvOps } from "./quick";

const limits = { evStatMax: 252, evTotalMax: 510, ivMax: 31 } as never;

describe("acciones rapidas", () => {
  it("los presets de EV caben en los limites", () => {
    expect(evPresetValues("physical", limits)).toEqual({ HP: 4, ATTACK: 252, DEFENSE: 0, SPECIAL_ATTACK: 0, SPECIAL_DEFENSE: 0, SPEED: 252 });
    expect(evPresetValues("none", limits)).toEqual({ HP: 0, ATTACK: 0, DEFENSE: 0, SPECIAL_ATTACK: 0, SPECIAL_DEFENSE: 0, SPEED: 0 });
  });

  it("respeta un maximo por estadistica y un total menores (bases antiguas o personalizadas)", () => {
    const v = evPresetValues("bulky", { evStatMax: 100, evTotalMax: 150 });
    expect(v.HP).toBe(100);
    expect(v.DEFENSE).toBe(50);
    expect(Object.values(v).reduce((a, b) => a + b, 0)).toBe(150);
    expect(Math.max(...Object.values(v))).toBeLessThanOrEqual(100);
  });

  it("construye las ops en una lista (una transaccion)", () => {
    expect(healOps(["party/0", "party/1"])).toEqual([{ op: "pokemon.heal", ref: "party/0" }, { op: "pokemon.heal", ref: "party/1" }]);
    const [iv] = perfectIvOps({ ref: "party/0", limits });
    expect(iv).toMatchObject({ op: "pokemon.patch", ref: "party/0", patch: { iv: { HP: 31, SPEED: 31 } } });
    const [ev] = evPresetOps({ ref: "box/0/1", limits }, "special");
    expect(ev).toMatchObject({ patch: { ev: { SPECIAL_ATTACK: 252, SPEED: 252, HP: 4 } } });
  });
});
