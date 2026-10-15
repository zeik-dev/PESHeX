import { describe, expect, it } from "vitest";
import { clamp, fileName, formatBytes, formatDuration, formatMoney, formatNumber, hueFromString } from "./format";

describe("formatters", () => {
  it("formatea dinero y numeros segun el idioma", () => {
    expect(formatMoney(1234567, "en")).toBe("₽1,234,567");
    expect(formatMoney(1234567, "es")).toBe("₽1.234.567");
    expect(formatMoney(null, "es")).toBe("—");
    expect(formatNumber(undefined, "en")).toBe("—");
  });

  it("formatea duraciones cortas", () => {
    expect(formatDuration(39030)).toBe("10 h 50 min");
    expect(formatDuration(125)).toBe("2 min");
    expect(formatDuration(40)).toBe("40 s");
    expect(formatDuration(null)).toBe("—");
  });

  it("extrae el nombre de archivo de rutas Windows y Unix", () => {
    expect(fileName("C:\\Juegos\\Mi Fangame\\Game.rxdata")).toBe("Game.rxdata");
    expect(fileName("/home/u/Partida.rxdata")).toBe("Partida.rxdata");
  });

  it("el matiz del sprite es estable y esta en rango", () => {
    expect(hueFromString("PIKACHU")).toBe(hueFromString("PIKACHU"));
    for (const s of ["a", "BULBASAUR", "ñandú", ""]) {
      const h = hueFromString(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("clamp", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

describe("formatBytes", () => {
  it("elige la unidad y los decimales", () => {
    expect(formatBytes(0, "es")).toBe("0 B");
    expect(formatBytes(820, "es")).toBe("820 B");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(17_538_957, "es")).toBe("16,7 MB");
    expect(formatBytes(250 * 1024 * 1024, "en")).toBe("250 MB");
    expect(formatBytes(null, "es")).toBe("—");
    expect(formatBytes(-1, "es")).toBe("—");
  });
});
