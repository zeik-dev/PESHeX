import { describe, expect, it } from "vitest";
import { damerau, matchScore, rankSearch, similarity, uniqueBestMatch } from "./fuzzy";
import { norm, pad3, stripExt } from "./normalize";

describe("normalize", () => {
  it("quita acentos, signos y mayusculas", () => {
    expect(norm("Mr. Mime")).toBe("MRMIME");
    expect(norm("Pokémon Ball")).toBe("POKEMONBALL");
    expect(norm("Ñandú_2")).toBe("NANDU2");
  });
  it("utilidades de nombre", () => {
    expect(stripExt("BULBASAUR.png")).toBe("BULBASAUR");
    expect(stripExt("a.b.png")).toBe("a.b");
    expect(pad3(5)).toBe("005");
    expect(pad3(150)).toBe("150");
  });
});

describe("damerau", () => {
  it("cuenta insercion, borrado, sustitucion y trasposicion", () => {
    expect(damerau("kitten", "sitting")).toBe(3);
    expect(damerau("ab", "ba")).toBe(1);
    expect(damerau("", "abc")).toBe(3);
    expect(damerau("igual", "igual")).toBe(0);
  });
  it("similarity va de 0 a 1", () => {
    expect(similarity("PIKACHU", "PIKACHU")).toBe(1);
    expect(similarity("", "")).toBe(1);
    expect(similarity("ABC", "XYZ")).toBe(0);
  });
});

describe("uniqueBestMatch", () => {
  const names = ["BULBASAUR", "IVYSAUR", "VENUSAUR", "CHARMANDER"];
  it("devuelve el unico candidato claramente mas parecido", () => {
    expect(uniqueBestMatch("Bulbasaurr", names, (n) => n)).toBe("BULBASAUR");
  });
  it("no asigna nada si no hay nadie suficientemente parecido", () => {
    expect(uniqueBestMatch("Pikachu", names, (n) => n)).toBeNull();
  });
  it("no asigna nada si es ambiguo (dos candidatos casi iguales)", () => {
    expect(uniqueBestMatch("FAKEMON1", ["FAKEMON2", "FAKEMON3"], (n) => n, 0.8)).toBeNull();
  });
  it("una consulta vacia no encaja con nada", () => {
    expect(uniqueBestMatch("", names, (n) => n)).toBeNull();
  });
});

describe("rankSearch", () => {
  const items = [
    { id: "MRMIME", name: "Mr. Mime" },
    { id: "MIMIKYU", name: "Mimikyu" },
    { id: "MIME_JR", name: "Mime Jr." },
    { id: "PIKACHU", name: "Pikachu" },
    { id: "GENGAR", name: "Gengar" },
  ];
  const keys = (i: (typeof items)[number]) => [i.name, i.id];

  it("sin consulta devuelve los primeros", () => {
    expect(rankSearch(items, "", keys, 2).map((i) => i.id)).toEqual(["MRMIME", "MIMIKYU"]);
  });
  it("ordena: exacto > prefijo > inicio de palabra > contiene", () => {
    expect(rankSearch(items, "mime", keys).map((i) => i.id)).toEqual(["MIME_JR", "MRMIME"]);
    expect(rankSearch(items, "mim", keys).map((i) => i.id)).toEqual(["MIME_JR", "MIMIKYU", "MRMIME"]);
  });
  it("ignora acentos y mayusculas", () => {
    const list = [{ id: "A", name: "Pokémon Ball" }];
    expect(rankSearch(list, "pokemon", (i) => [i.name])).toHaveLength(1);
  });
  it("tolera un error de tecleo", () => {
    expect(rankSearch(items, "pikahcu", keys)[0]?.id).toBe("PIKACHU");
  });
  it("respeta el limite y no devuelve lo que no encaja", () => {
    expect(rankSearch(items, "zzzz", keys)).toEqual([]);
    expect(rankSearch(items, "m", keys, 1)).toHaveLength(1);
  });
  it("matchScore es 0 sin coincidencia", () => {
    expect(matchScore("xyz", "Pikachu")).toBe(0);
    expect(matchScore("", "Pikachu")).toBe(0);
  });
});
