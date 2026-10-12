import { describe, expect, it } from "vitest";
import es from "./es.json";
import en from "./en.json";
import { pickLang, resolveLang } from "./index";

type Tree = { [k: string]: string | Tree };

/** Aplana a rutas "a.b.c" y quita el sufijo de plural (_one/_many/_other...),
 *  porque cada idioma tiene sus propias categorias plurales. */
function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [ck, cv] of flatten(v, key)) out.set(ck, cv);
  }
  return out;
}

const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, "");
const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe("diccionarios es/en", () => {
  const esMap = flatten(es as Tree);
  const enMap = flatten(en as Tree);

  it("tienen las mismas claves (ignorando sufijos de plural)", () => {
    const a = new Set([...esMap.keys()].map(base));
    const b = new Set([...enMap.keys()].map(base));
    const missingInEn = [...a].filter((k) => !b.has(k));
    const missingInEs = [...b].filter((k) => !a.has(k));
    expect({ missingInEn, missingInEs }).toEqual({ missingInEn: [], missingInEs: [] });
  });

  it("usan los mismos placeholders en cada clave", () => {
    const byBase = (m: Map<string, string>) => {
      const out = new Map<string, string[]>();
      for (const [k, v] of m) {
        const b = base(k);
        out.set(b, [...new Set([...(out.get(b) ?? []), ...placeholders(v)])].sort());
      }
      return out;
    };
    const a = byBase(esMap);
    const b = byBase(enMap);
    const diffs = [...a].filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(b.get(k))).map(([k]) => k);
    expect(diffs).toEqual([]);
  });

  it("no tienen textos vacios", () => {
    for (const [, v] of [...esMap, ...enMap]) expect(v.trim()).not.toBe("");
  });

  it("los plurales de es cubren one y other (many es opcional)", () => {
    const keys = [...esMap.keys()].filter((k) => k.endsWith("_one"));
    for (const k of keys) expect(esMap.has(k.replace(/_one$/, "_other"))).toBe(true);
  });
});

describe("deteccion de idioma", () => {
  it("elige es para cualquier variante de espanol y en en otro caso", () => {
    expect(pickLang(["es-ES"])).toBe("es");
    expect(pickLang(["es_AR"])).toBe("es");
    expect(pickLang(["en-US"])).toBe("en");
    expect(pickLang(["fr-FR", "es-MX"])).toBe("es");
    expect(pickLang(["fr-FR"])).toBe("en");
    expect(pickLang([])).toBe("en");
  });

  it("la preferencia explicita gana a la del sistema", () => {
    expect(resolveLang("en", ["es-ES"])).toBe("en");
    expect(resolveLang("es", ["en-US"])).toBe("es");
    expect(resolveLang("auto", ["es-ES"])).toBe("es");
  });
});
