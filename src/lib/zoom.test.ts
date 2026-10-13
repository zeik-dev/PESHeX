import { afterEach, describe, expect, it, vi } from "vitest";
import { applyZoom, clampZoom, stepZoom, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from "./zoom";

describe("clampZoom", () => {
  it("acota a 50-200, redondea y usa 100 si no es un numero", () => {
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(10)).toBe(ZOOM_MIN);
    expect(clampZoom(900)).toBe(ZOOM_MAX);
    expect(clampZoom(124.6)).toBe(125);
    expect(clampZoom("150")).toBe(150);
    for (const bad of [Number.NaN, Infinity, "x", "", "  ", undefined, null, {}, true]) expect(clampZoom(bad)).toBe(ZOOM_DEFAULT);
  });
});

describe("stepZoom", () => {
  it("sube y baja de 10 en 10 hasta los topes", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(100, -1)).toBe(90);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  it("desde un valor que no es multiplo de 10 cae en el multiplo mas cercano de esa direccion", () => {
    expect(stepZoom(105, 1)).toBe(110);
    expect(stepZoom(105, -1)).toBe(100);
    expect(stepZoom(195, 1)).toBe(200);
    expect(stepZoom(55, -1)).toBe(50);
  });

  it("ida y vuelta de un multiplo de 10 vuelve al mismo valor", () => {
    for (let z = 60; z <= 190; z += 10) expect(stepZoom(stepZoom(z, 1), -1)).toBe(z);
  });
});

describe("applyZoom", () => {
  afterEach(() => {
    vi.doUnmock("@tauri-apps/api/webview");
    vi.resetModules();
    document.documentElement.style.removeProperty("zoom");
  });

  it("usa el zoom nativo del WebView con el factor en 0-2", async () => {
    const setZoom = vi.fn().mockResolvedValue(undefined);
    vi.resetModules();
    vi.doMock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom }) }));
    const mod = await import("./zoom");
    await mod.applyZoom(125);
    expect(setZoom).toHaveBeenCalledWith(1.25);
    await mod.applyZoom(9999);
    expect(setZoom).toHaveBeenLastCalledWith(2);
    expect(document.documentElement.style.zoom).toBe("");
  });

  it("sin Tauri cae a zoom CSS (y 100 % lo quita)", async () => {
    vi.resetModules();
    vi.doMock("@tauri-apps/api/webview", () => ({
      getCurrentWebview: () => {
        throw new Error("no hay Tauri");
      },
    }));
    const mod = await import("./zoom");
    await mod.applyZoom(150);
    expect(document.documentElement.style.zoom).toBe("1.5");
    await mod.applyZoom(100);
    expect(document.documentElement.style.zoom).toBe("");
  });

  it("es una funcion exportada y estable", () => {
    expect(typeof applyZoom).toBe("function");
  });
});
