import { describe, expect, it } from "vitest";
import { catalogResolver, GUESS_RESOLVER, parsePokemonJson, parseShowdown, resolveSet, SCHEMA } from "./showdown";

const SAMPLE = `Pichu (Pikachu) (F) @ Light Ball
Ability: Static
Level: 50
Shiny: Yes
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
IVs: 0 Atk
- Thunderbolt
- Volt Switch
- Fire Blast

Charizard @ Charcoal
Ability: Blaze
- Flamethrower`;

describe("parseShowdown", () => {
  it("lee apodo, especie, genero, objeto y campos", () => {
    const [a, b] = parseShowdown(SAMPLE);
    expect(a).toMatchObject({ species: "Pikachu", nickname: "Pichu", gender: 1, item: "Light Ball", ability: "Static", level: 50, shiny: true, nature: "Timid" });
    expect(a.ev).toEqual({ SPECIAL_ATTACK: 252, SPECIAL_DEFENSE: 4, SPEED: 252 });
    expect(a.iv).toEqual({ ATTACK: 0 });
    expect(a.moves).toEqual(["Thunderbolt", "Volt Switch", "Fire Blast"]);
    expect(b).toMatchObject({ species: "Charizard", item: "Charcoal", nickname: undefined });
    expect(b.moves).toEqual(["Flamethrower"]);
  });

  it("acepta CRLF y descarta bloques vacios o sin especie", () => {
    expect(parseShowdown("\r\n\r\n")).toEqual([]);
    expect(parseShowdown("- Tackle")).toEqual([]);
    expect(parseShowdown("Eevee (M)\r\nLevel: 5\r\n")[0]).toMatchObject({ species: "Eevee", gender: 0, level: 5 });
  });

  it("ignora lineas desconocidas sin fallar", () => {
    const [s] = parseShowdown("Mew\nRaro: cosa\nEVs: 999 Nada\nlinea suelta");
    expect(s.species).toBe("Mew");
    expect(s.ev).toEqual({});
  });
});

describe("resolveSet", () => {
  const catalog = catalogResolver({
    species: [
      { id: "PIKACHU", name: "Pikachu" }, { id: "PIKACHU_1", name: "Pikachu" }, { id: "CHARIZARD", name: "Charizard" },
    ],
    items: [{ id: "LIGHTBALL", name: "Light Ball" }],
    abilities: [{ id: "STATIC", name: "Static" }],
    moves: [{ id: "THUNDERBOLT", name: "Thunderbolt" }, { id: "VOLTSWITCH", name: "Volt Switch" }],
  });

  it("resuelve nombres a IDs del juego y avisa de lo desconocido", () => {
    const r = resolveSet(parseShowdown(SAMPLE)[0], catalog);
    expect(r.data).toMatchObject({
      species: "PIKACHU", nickname: "Pichu", gender: 1, item: "LIGHTBALL", ability: "STATIC", level: 50, shiny: true, nature: "TIMID",
    });
    expect(r.data?.moves?.map((m) => m.id)).toEqual(["THUNDERBOLT", "VOLTSWITCH"]);
    expect(r.warnings).toEqual([{ code: "unknown_move", name: "Fire Blast" }]);
  });

  it("especie desconocida -> sin datos", () => {
    const r = resolveSet(parseShowdown("Missingno")[0], catalog);
    expect(r.data).toBeNull();
    expect(r.unknownSpecies).toBe("Missingno");
  });

  it("sin catalogo adivina el ID por el nombre normalizado", () => {
    const r = resolveSet(parseShowdown("Mr. Mime @ Leftovers\n- Fire Blast")[0], GUESS_RESOLVER);
    expect(r.data).toMatchObject({ species: "MRMIME", item: "LEFTOVERS" });
    expect(r.data?.moves?.[0].id).toBe("FIREBLAST");
  });

  it("limita los movimientos y rechaza naturalezas inventadas", () => {
    const r = resolveSet(parseShowdown("Mew\nPicara Nature\n- A\n- B\n- C\n- D\n- E")[0], GUESS_RESOLVER, 4);
    expect(r.data?.moves).toHaveLength(4);
    expect(r.warnings).toEqual([{ code: "unknown_nature", name: "Picara" }]);
  });

  it("entre formas con el mismo nombre gana la base", () => {
    const c = catalogResolver({ species: [{ id: "PIKACHU_1", name: "Pikachu" }, { id: "PIKACHU", name: "Pikachu" }], items: [], abilities: [], moves: [] });
    expect(c.species("pikachu")).toBe("PIKACHU");
  });
});

describe("parsePokemonJson", () => {
  it("acepta el esquema y descarta lo que no se puede importar", () => {
    const r = parsePokemonJson(JSON.stringify({
      schema: SCHEMA, species: "PIKACHU", level: 30, item: null, nickname: "Pika", owner: { name: "X" }, personalId: 5,
      iv: { HP: 31, ATTACK: null }, moves: [{ id: "TACKLE", pp: 35, ppUps: 0 }, { id: null }],
    }));
    expect(r).toEqual({
      ok: true,
      data: { species: "PIKACHU", level: 30, nickname: "Pika", iv: { HP: 31 }, moves: [{ slot: 0, id: "TACKLE", pp: 35, ppUps: 0 }] },
    });
  });

  it("rechaza lo que no es de PESHeX", () => {
    expect(parsePokemonJson("{")).toEqual({ ok: false, reason: "invalid_json" });
    expect(parsePokemonJson("[]")).toEqual({ ok: false, reason: "not_peshex" });
    expect(parsePokemonJson(JSON.stringify({ species: "X" }))).toEqual({ ok: false, reason: "not_peshex" });
    expect(parsePokemonJson(JSON.stringify({ schema: SCHEMA }))).toEqual({ ok: false, reason: "no_species" });
  });
});
