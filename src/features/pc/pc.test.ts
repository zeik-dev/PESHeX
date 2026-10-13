import { describe, expect, it } from "vitest";
import { pickScale, REST_H, REST_W } from "./usePcScale";

describe("pickScale", () => {
  it("usa la escala mas grande que cabe en ancho y en el alto del contenedor", () => {
    expect(pickScale(1160, REST_H + 296 * 2)).toBe(2);
    expect(pickScale(1160, REST_H + 296 * 2 - 1)).toBe(1.5);
    expect(pickScale(1160, REST_H + 296 * 1.5)).toBe(1.5);
    expect(pickScale(1160, REST_H + 296 * 1.5 - 1)).toBe(1);
    expect(pickScale(900, 1000)).toBe(1); // 900 - 470 = 430 solo da para la escala 1
  });
  it("sin limite de alto solo manda el ancho", () => {
    expect(pickScale(REST_W + 648)).toBe(2);
    expect(pickScale(REST_W + 486)).toBe(1.5);
    expect(pickScale(REST_W + 324)).toBe(1);
  });
  it("en pantallas estrechas se encoge sin pasar de 1 ni bajar de 0,5", () => {
    expect(pickScale(500)).toBeLessThanOrEqual(1);
    expect(pickScale(500)).toBeGreaterThanOrEqual(0.5);
    expect(pickScale(100)).toBe(0.5);
  });
});
