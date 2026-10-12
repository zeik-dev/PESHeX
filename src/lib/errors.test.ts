import { beforeAll, describe, expect, it } from "vitest";
import i18n, { initI18n } from "../i18n";
import { errorText } from "./errors";

beforeAll(() => {
  initI18n("es");
});

describe("mensajes de error", () => {
  it("traduce errores del driver con parametros", async () => {
    await i18n.changeLanguage("es");
    expect(errorText(i18n.t, { kind: "PokemonNotFound", message: "x", params: { ref: "party/9" } })).toBe(
      "No hay ningún Pokémon en «party/9».",
    );
    expect(errorText(i18n.t, { kind: "ValidationError", message: "m", params: { code: "type_mismatch", field: "money", expected: "int" } })).toContain("«money»");
  });

  it("traduce los errores del PC y de la carpeta del juego", async () => {
    await i18n.changeLanguage("es");
    expect(errorText(i18n.t, { kind: "PartyFull", message: "x", params: { max: 6 } })).toBe("El equipo está lleno (máximo 6).");
    expect(errorText(i18n.t, { kind: "NotAGameFolder", message: "x" })).toContain("Game.ini");
    await i18n.changeLanguage("en");
    expect(errorText(i18n.t, { kind: "PartyTooSmall", message: "x" })).toBe("The party cannot be left empty.");
  });

  it("cae al mensaje original si el tipo de error es desconocido", async () => {
    await i18n.changeLanguage("en");
    expect(errorText(i18n.t, { kind: "Algo", message: "boom" })).toBe("boom");
  });
});
