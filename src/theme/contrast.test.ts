import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Contraste WCAG de los pares de tokens del tema Poké Ball (claro y oscuro).
const css = fs.readFileSync(path.resolve(__dirname, "tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no se encontro ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const resolve = (vars: Record<string, string>, name: string): string => {
  let v = vars[name];
  while (v?.startsWith("var(")) v = vars[v.slice(4, -1)];
  return v;
};

describe("contraste de tokens", () => {
  it("texto blanco sobre el rojo fuerte cumple AA (>= 4.5)", () => {
    expect(ratio("#ffffff", light["--pb-red-strong"])).toBeGreaterThanOrEqual(4.5);
  });

  it("el rojo base (#EE1515) solo sirve para texto grande (>= 3)", () => {
    const r = ratio("#ffffff", light["--pb-red"]);
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeLessThan(4.5);
  });

  for (const [name, vars] of [["claro", light], ["oscuro", dark]] as const) {
    it(`tema ${name}: texto y texto atenuado legibles sobre las superficies`, () => {
      for (const surface of ["--bg", "--surface", "--surface-2"]) {
        expect(ratio(resolve(vars, "--text"), resolve(vars, surface))).toBeGreaterThanOrEqual(7);
        expect(ratio(resolve(vars, "--text-muted"), resolve(vars, surface))).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`tema ${name}: acento y estados legibles sobre la superficie`, () => {
      const surface = resolve(vars, "--surface");
      for (const t of ["--accent", "--success", "--warning", "--danger", "--info", "--stat-ev"]) {
        expect(ratio(resolve(vars, t), surface), t).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`tema ${name}: chips de estado legibles sobre su fondo suave`, () => {
      for (const [fg, bg] of [["--success", "--success-soft"], ["--warning", "--warning-soft"], ["--danger", "--danger-soft"], ["--info", "--info-soft"], ["--accent", "--accent-soft"]]) {
        expect(ratio(resolve(vars, fg), resolve(vars, bg)), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("cada ball theme mantiene el texto blanco legible sobre su color primario", () => {
    for (const ball of ["great", "ultra", "master"]) {
      const vars = block(`:root[data-ball="${ball}"]`);
      expect(ratio("#ffffff", vars["--pb-red-strong"]), ball).toBeGreaterThanOrEqual(4.5);
    }
  });
});
