import { beforeAll, describe, expect, it } from "vitest";
import type { Flag } from "../api/types";
import i18n, { initI18n } from "../i18n";
import { flagText, sortFlags, worstSeverity } from "./legality";

beforeAll(() => {
  initI18n("es");
});

const flag = (code: string, severity: Flag["severity"], subject?: string, params: Record<string, unknown> = {}): Flag => ({
  code, severity, subject, params,
});

describe("flagText", () => {
  it("usa el nombre del juego del movimiento y cae al id si no se conoce", async () => {
    await i18n.changeLanguage("es");
    const f = flag("move_not_learnable", "illegal", "HYPERBEAM", { level: 23 });
    expect(flagText(i18n.t, f, { move: () => "Hiperrayo", item: () => undefined, ability: () => undefined })).toBe(
      "Hiperrayo no lo puede aprender esta especie (a nivel 23).",
    );
    expect(flagText(i18n.t, f)).toContain("HYPERBEAM");
  });

  it("nombra la estadistica en IV/EV en los dos idiomas", async () => {
    const f = flag("iv_range", "illegal", "SPEED", { value: 40, min: 0, max: 31 });
    await i18n.changeLanguage("es");
    expect(flagText(i18n.t, f)).toBe("IV de Velocidad = 40, fuera de rango (0–31).");
    await i18n.changeLanguage("en");
    expect(flagText(i18n.t, f)).toBe("Speed IV = 40, out of range (0–31).");
  });

  it("une la lista de estadisticas de stats_mismatch", async () => {
    await i18n.changeLanguage("es");
    const t = flagText(i18n.t, flag("stats_mismatch", "warning", undefined, { stats: ["HP", "SPEED"] }));
    expect(t).toContain("PS, Velocidad");
  });

  it("un codigo sin traduccion muestra el codigo en vez de una clave rota", async () => {
    await i18n.changeLanguage("en");
    expect(flagText(i18n.t, flag("regla_nueva", "info"))).toBe("regla_nueva");
  });
});

describe("severidades", () => {
  it("ordena de mas a menos grave y calcula la peor", () => {
    const list = [flag("b", "info"), flag("a", "warning"), flag("c", "illegal")];
    expect(sortFlags(list).map((f) => f.severity)).toEqual(["illegal", "warning", "info"]);
    expect(worstSeverity(list)).toBe("illegal");
    expect(worstSeverity([flag("a", "warning"), flag("b", "info")])).toBe("warning");
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity(undefined)).toBeNull();
  });
});
