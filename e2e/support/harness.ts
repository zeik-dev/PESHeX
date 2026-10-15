// Utilidades comunes de las pruebas e2e nuevas (modos, carpeta del juego, PC...).
import { expect, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DriverBridge, TAURI_MOCK } from "./bridge";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SHOTS = path.join(ROOT, "e2e", "screenshots");

/** Reproduce el zoom NATIVO del WebView en Chromium: con zoom z el viewport en px CSS es (físico / z) y devicePixelRatio = z
 *  (como Ctrl+rueda en WebView2). Así se prueban la escala automática y el redimensionado de la ventana sin Tauri.
 *  El tamaño FÍSICO de la ventana es el viewport de Playwright (`page.setViewportSize` también lo cambia). */
export class ZoomEmulator {
  zoom = 1;
  private cdp: import("@playwright/test").CDPSession | null = null;
  constructor(private page: Page) {}
  private physical() {
    return this.page.viewportSize() ?? { width: 1280, height: 820 };
  }
  private async apply() {
    this.cdp ??= await this.page.context().newCDPSession(this.page);
    const { width, height } = this.physical();
    await this.cdp.send("Emulation.setDeviceMetricsOverride", {
      width: Math.round(width / this.zoom),
      height: Math.round(height / this.zoom),
      deviceScaleFactor: this.zoom,
      mobile: false,
    });
  }
  async setZoom(factor: number) {
    this.zoom = factor;
    await this.apply();
  }
  /** Cambia el tamaño de la ventana (px físicos), como arrastrar el borde o maximizar. */
  async resize(width: number, height: number) {
    await this.page.setViewportSize({ width, height });
    await this.apply(); // Playwright restablece las métricas: se vuelve a aplicar el zoom nativo emulado
  }
}

export interface Env {
  bridge: DriverBridge;
  workDir: string;
  savePath: string;
  /** Emulador del zoom nativo del WebView y del tamaño de la ventana. */
  window: ZoomEmulator;
  /** Deja salir el aviso de "agregar la carpeta del juego" al abrir (por defecto se silencia). */
  gamePrompt: boolean;
  /** Zoom manual fijo (en %) en vez del automático (lo usan las capturas del README). */
  manualZoom?: number;
}

/** Marca «No volver a preguntar» para `savePath` antes de cargar la app (el aviso no estorba a las pruebas que no lo ejercitan).
 *  Los ajustes se guardan en versión 2 a propósito: la migración a la 3 da por hecho el asistente del primer arranque, y el
 *  zoom queda en automático (el valor por defecto). `lang` fija el idioma (el por defecto de la app es el español). */
export async function silenceGamePrompt(page: Page, savePath: string | null, lang: "es" | "en" = "es", manualZoom?: number) {
  await page.addInitScript(
    ([p, l, z]) => {
      // Con `manualZoom` los ajustes se guardan ya en la versión 3: zoom manual fijo (las capturas del README no usan la escala automática).
      const state = { ...(p ? { noGamePrompt: { [p]: true } } : {}), lang: l, ...(z ? { firstRunDone: true, zoomMode: "manual", zoom: z } : {}) };
      localStorage.setItem("peshex-settings", JSON.stringify({ state, version: z ? 3 : 2 }));
    },
    [savePath, lang, manualZoom ?? 0] as const,
  );
}

/** Prepara la pagina con el puente al driver real y una COPIA del save (nunca se toca test_saves/).
 *  Por defecto se marca «No volver a preguntar» para esa partida: el aviso de "agregar la carpeta del juego" que sale
 *  al abrir un save sin carpeta no estorba a las pruebas que no lo ejercitan (`gamePrompt: true` lo deja salir). */
export async function setup(page: Page, save = "Partida_2.rxdata", opts: { gamePrompt?: boolean; manualZoom?: number } = {}): Promise<Env> {
  fs.mkdirSync(SHOTS, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "peshex-e2e-"));
  const savePath = path.join(workDir, save);
  fs.copyFileSync(path.join(ROOT, "test_saves", save), savePath);
  const bridge = new DriverBridge(ROOT);
  bridge.dialogPath = savePath;
  await page.exposeFunction("__pwInvoke", (cmd: string, args: Record<string, unknown>) => bridge.handle(cmd, args));
  await page.addInitScript(TAURI_MOCK);
  await page.addInitScript(() => localStorage.clear());
  const window = new ZoomEmulator(page);
  // Si la página ya se cerró (el último ajuste de zoom llega tarde), se ignora el fallo.
  bridge.emit = (event, payload) => page.evaluate(([e, p]) => (window as unknown as { __pwEmit?: (e: string, p: unknown) => void }).__pwEmit?.(e, p), [event, payload] as const).catch(() => undefined);
  bridge.onZoom = (z) => void window.setZoom(z).catch(() => undefined);
  return { bridge, workDir, savePath, window, gamePrompt: !!opts.gamePrompt, manualZoom: opts.manualZoom };
}

export async function teardown(env: Env | undefined) {
  if (!env) return;
  await env.bridge.dispose();
  fs.rmSync(env.workDir, { recursive: true, force: true });
}

export async function openSave(page: Page, env: Env, lang: "es" | "en" = "es", expected = "Furikita") {
  await page.addInitScript((l) => {
    Object.defineProperty(navigator, "languages", { get: () => [l === "es" ? "es-ES" : "en-US"] });
    Object.defineProperty(navigator, "language", { get: () => (l === "es" ? "es-ES" : "en-US") });
  }, lang);
  // Con `gamePrompt` el aviso de la carpeta del juego sale; el asistente del primer arranque y el idioma se fijan siempre.
  await silenceGamePrompt(page, env.gamePrompt ? null : env.bridge.dialogPath, lang, env.manualZoom);
  await page.goto("/");
  await page.getByRole("button", { name: lang === "es" ? "Abrir partida…" : "Open save…" }).click();
  await expect(page.getByText(expected).first()).toBeVisible({ timeout: 20_000 });
}

export async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

/** Sirve las URLs `/__game/<base64url>` (el "asset protocol" simulado) desde disco. `mode` permite simular que
 *  el protocolo falla (403) para probar el plan B de bytes por IPC. */
export async function serveGameAssets(page: Page, mode: { value: "ok" | "forbidden" } = { value: "ok" }) {
  await page.route("**/__game/**", async (route: Route) => {
    if (mode.value === "forbidden") return route.fulfill({ status: 403, body: "denied" });
    const enc = new URL(route.request().url()).pathname.replace("/__game/", "");
    const file = Buffer.from(enc.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "nope" });
    return route.fulfill({ status: 200, contentType: "image/png", body: fs.readFileSync(file) });
  });
}

/** Cuantas imagenes del juego (asset protocol o blob) estan realmente cargadas en la pagina. */
export async function loadedGameImages(page: Page): Promise<number> {
  return page.evaluate(
    () => [...document.images].filter((i) => i.naturalWidth > 0 && (i.src.includes("/__game/") || i.src.startsWith("blob:"))).length,
  );
}

/** Cambia de modo desde la cabecera. HeX pide confirmacion (aviso previo): se acepta. */
export async function setMode(page: Page, mode: "hex" | "hax", lang: "es" | "en" = "es") {
  await page.getByRole("radio", { name: mode === "hex" ? "HeX" : "HaX" }).first().click();
  if (mode === "hex") {
    const dialog = page.getByRole("dialog", { name: lang === "es" ? "Activar el modo HeX" : "Turn on HeX mode" });
    await dialog.getByRole("button", { name: lang === "es" ? "Activar HeX" : "Turn on HeX" }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(page.getByRole("radio", { name: mode === "hex" ? "HeX" : "HaX" }).first()).toHaveAttribute("aria-checked", "true");
}
