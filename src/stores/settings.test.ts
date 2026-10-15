import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSettings } from "./settings";

const KEY = "peshex-settings";

async function rehydrateWith(stored: unknown) {
  if (stored === undefined) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(stored));
  await useSettings.persist.rehydrate();
  return useSettings.getState();
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("ajustes: valores por defecto y migración a la versión 3", () => {
  it("primer arranque: español, asistente pendiente y zoom automático", async () => {
    useSettings.setState({ lang: "es", firstRunDone: false, zoomMode: "auto", zoom: 100 });
    const s = await rehydrateWith(undefined);
    expect(s.lang).toBe("es");
    expect(s.firstRunDone).toBe(false);
    expect(s.zoomMode).toBe("auto");
  });

  it("quien ya usaba la app no pasa por el asistente y conserva su idioma", async () => {
    const s = await rehydrateWith({ state: { lang: "en", zoom: 100, mode: "hex" }, version: 2 });
    expect(s.firstRunDone).toBe(true);
    expect(s.lang).toBe("en");
    expect(s.zoomMode).toBe("auto"); // tenía el 100 % por defecto -> automático
    expect(s.mode).toBe("hex"); // la versión 2 ya había restablecido el modo
  });

  it("si había cambiado el zoom a mano lo conserva en modo manual", async () => {
    const s = await rehydrateWith({ state: { zoom: 130 }, version: 2 });
    expect(s.zoomMode).toBe("manual");
    expect(s.zoom).toBe(130);
  });

  it("la versión 1 sigue restableciendo el modo a HaX", async () => {
    const s = await rehydrateWith({ state: { mode: "hex", zoom: 100 }, version: 1 });
    expect(s.mode).toBe("hax");
    expect(s.firstRunDone).toBe(true);
  });

  it("ya en la versión 3 no se toca nada", async () => {
    const s = await rehydrateWith({ state: { firstRunDone: false, zoomMode: "manual", zoom: 90 }, version: 3 });
    expect(s.firstRunDone).toBe(false);
    expect(s.zoomMode).toBe("manual");
    expect(s.zoom).toBe(90);
  });
});
