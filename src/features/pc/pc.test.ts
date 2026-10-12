import { describe, expect, it } from "vitest";
import { pickScale } from "./usePcScale";

describe("pickScale", () => {
  it("usa la escala mas grande que cabe en ancho y alto", () => {
    expect(pickScale(1160, 1000)).toBe(2);
    expect(pickScale(1160, 820)).toBe(1.5);
    expect(pickScale(1160, 650)).toBe(1);
    expect(pickScale(900, 1000)).toBe(1);
  });
  it("sin limite de alto solo manda el ancho", () => {
    expect(pickScale(1200)).toBe(2);
    expect(pickScale(950)).toBe(1.5);
    expect(pickScale(800)).toBe(1);
  });
  it("en pantallas estrechas se encoge sin pasar de 1 ni bajar de 0,5", () => {
    expect(pickScale(500)).toBeLessThanOrEqual(1);
    expect(pickScale(500)).toBeGreaterThanOrEqual(0.5);
    expect(pickScale(100)).toBe(0.5);
  });
});
