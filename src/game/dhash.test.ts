import { describe, expect, it } from "vitest";
import { dhash, firstFrame, hamming, hashImage, luminanceGrid, nearest, silhouette, type Rgba } from "./dhash";
import { emptyMap, lookup, normalizeMap, withIgnored, withMapping } from "./assetmap";

/** Imagen sintetica: f(x, y) -> [r,g,b,a]. */
function img(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Rgba {
  const data: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.push(...f(x, y));
  return { data, width: w, height: h };
}
const gray = (v: number): [number, number, number, number] => [v, v, v, 255];

// Degradado horizontal creciente / decreciente / cuadrado opaco sobre fondo transparente.
const rising = img(32, 32, (x) => gray(Math.round((x / 31) * 255)));
const falling = img(32, 32, (x) => gray(255 - Math.round((x / 31) * 255)));
const blob = img(32, 32, (x, y) => (x >= 8 && x < 24 && y >= 8 && y < 24 ? gray(30) : [0, 0, 0, 0]));
const wideBlob = img(32, 32, (_x, y) => (y >= 12 && y < 20 ? gray(30) : [0, 0, 0, 0]));

describe("dHash", () => {
  it("la misma imagen da el mismo hash y la invertida es muy distinta", () => {
    expect(dhash(rising)).toBe(dhash(rising));
    expect(hamming(dhash(rising), dhash(falling))).toBeGreaterThan(50);
  });
  it("es robusto a un escalado (misma imagen a otro tamano)", () => {
    const big = img(64, 64, (x) => gray(Math.round((x / 63) * 255)));
    expect(hamming(dhash(rising), dhash(big))).toBeLessThanOrEqual(4);
  });
  it("es robusto a ruido pequeno", () => {
    const noisy = img(32, 32, (x, y) => gray(Math.min(255, Math.max(0, Math.round((x / 31) * 255) + ((x * 7 + y * 3) % 5) - 2))));
    expect(hamming(dhash(rising), dhash(noisy))).toBeLessThanOrEqual(6);
  });
  it("hamming cuenta bits distintos", () => {
    expect(hamming(0b1011n, 0b0010n)).toBe(2);
    expect(hamming(0n, 0n)).toBe(0);
    expect(hamming(0xffff_ffff_ffff_ffffn, 0n)).toBe(64);
  });
  it("luminanceGrid promedia por zonas", () => {
    const g = luminanceGrid(img(4, 4, (x) => gray(x < 2 ? 0 : 200)), 2, 1);
    expect(g[0]).toBeCloseTo(0, 5);
    expect(g[1]).toBeCloseTo(200, 5);
  });
});

describe("silueta y tiras de cuadros", () => {
  it("distingue formas con la misma luminancia", () => {
    expect(hamming(silhouette(blob), silhouette(wideBlob))).toBeGreaterThan(8);
    expect(silhouette(blob)).toBe(silhouette(blob));
  });
  it("firstFrame recorta la tira al primer cuadro", () => {
    const strip = img(64, 32, (x) => (x < 32 ? gray(10) : gray(250)));
    const f = firstFrame(strip);
    expect([f.width, f.height]).toEqual([32, 32]);
    expect(f.data[0]).toBe(10);
    expect(hamming(dhash(strip), dhash(img(32, 32, () => gray(10))))).toBe(0);
  });
  it("una imagen cuadrada no se recorta", () => {
    expect(firstFrame(blob)).toBe(blob);
  });
});

describe("nearest", () => {
  const labeled = [
    { label: "RISING", path: "a.png", ...hashImage(rising) },
    { label: "FALLING", path: "b.png", ...hashImage(falling) },
    { label: "BLOB", path: "c.png", ...hashImage(blob) },
  ];
  it("sugiere el etiquetado mas parecido dentro de los umbrales", () => {
    const big = img(64, 64, (x) => gray(Math.round((x / 63) * 255)));
    const s = nearest(hashImage(big), labeled);
    expect(s[0]?.label).toBe("RISING");
    expect(s.map((x) => x.label)).not.toContain("FALLING");
  });
  it("no sugiere nada si nada se parece", () => {
    const other = img(32, 32, (x, y) => gray(((x >> 2) + (y >> 2)) % 2 ? 0 : 255));
    expect(nearest(hashImage(other), labeled.slice(0, 2))).toEqual([]);
  });
});

describe("assetmap", () => {
  it("normaliza JSON basura sin lanzar", () => {
    expect(normalizeMap(null)).toEqual(emptyMap());
    expect(normalizeMap("x")).toEqual(emptyMap());
    const m = normalizeMap({ pokemon: { icon: { A: "x.png", B: 3 } }, items: { P: "p.png" }, ignore: ["z", 4] });
    expect(m.pokemon.icon).toEqual({ A: "x.png" });
    expect(m.items).toEqual({ P: "p.png" });
    expect(m.ignore).toEqual(["z"]);
  });
  it("asignar y quitar es inmutable", () => {
    const a = emptyMap();
    const b = withMapping(a, "balls", "POKEBALL", "Graphics/x.png");
    expect(a.balls).toEqual({});
    expect(lookup(b, "balls", "POKEBALL")).toBe("Graphics/x.png");
    expect(lookup(withMapping(b, "balls", "POKEBALL", null), "balls", "POKEBALL")).toBeUndefined();
    expect(lookup(null, "balls", "X")).toBeUndefined();
  });
  it("ignorados sin duplicados", () => {
    let m = withIgnored(emptyMap(), "a.png", true);
    m = withIgnored(m, "a.png", true);
    expect(m.ignore).toEqual(["a.png"]);
    expect(withIgnored(m, "a.png", false).ignore).toEqual([]);
  });
});
