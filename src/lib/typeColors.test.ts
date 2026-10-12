import { describe, expect, it } from "vitest";
import { TYPE_IDS, typeStyle } from "./typeColors";

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("typeStyle", () => {
  it("los 18 tipos tienen texto legible (contraste >= 3:1, texto en negrita pequena)", () => {
    expect(TYPE_IDS).toHaveLength(18);
    for (const id of TYPE_IDS) {
      const s = typeStyle(id);
      expect(contrast(s.background, s.color), id).toBeGreaterThanOrEqual(3);
    }
  });
  it("tipo desconocido o nulo usa el color neutro", () => {
    expect(typeStyle("NO_EXISTE").background).toBe(typeStyle(null).background);
    expect(typeStyle("fire").background).toBe(typeStyle("FIRE").background);
  });
});
