import { beforeAll, describe, expect, it } from "vitest";
import i18n, { initI18n } from "../i18n";
import { errorText, issueText } from "./errors";

beforeAll(() => {
  initI18n("es");
});

describe("mensajes de error e issues", () => {
  it("traduce un issue de rango en es y en", async () => {
    const issue = { severity: "error", code: "value_range", params: { field: "money", value: 99999999, min: 0, max: 999999 } } as const;
    await i18n.changeLanguage("es");
    expect(issueText(i18n.t, issue)).toBe("Dinero: 99999999 está fuera del rango habitual (0–999999).");
    await i18n.changeLanguage("en");
    expect(issueText(i18n.t, issue)).toBe("Money: 99999999 is outside the usual range (0–999999).");
  });

  it("nombra la estadistica en los issues de IV/EV", async () => {
    await i18n.changeLanguage("es");
    const issue = { severity: "error", code: "value_range", params: { field: "iv.SPEED", value: 40, min: 0, max: 31 } } as const;
    expect(issueText(i18n.t, issue)).toContain("IV Velocidad");
  });

  it("traduce errores del driver con parametros", async () => {
    await i18n.changeLanguage("es");
    expect(errorText(i18n.t, { kind: "PokemonNotFound", message: "x", params: { ref: "party/9" } })).toBe(
      "No hay ningún Pokémon en «party/9».",
    );
    expect(errorText(i18n.t, { kind: "ValidationError", message: "m", params: { code: "type_mismatch", field: "money", expected: "int" } })).toContain("«money»");
  });

  it("cae al mensaje original si el tipo de error es desconocido", async () => {
    await i18n.changeLanguage("en");
    expect(errorText(i18n.t, { kind: "Algo", message: "boom" })).toBe("boom");
  });
});
