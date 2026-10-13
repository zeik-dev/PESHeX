// Utilidades comunes de las pruebas e2e nuevas (modos, carpeta del juego, PC...).
import { expect, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DriverBridge, TAURI_MOCK } from "./bridge";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SHOTS = path.join(ROOT, "e2e", "screenshots");

export interface Env {
  bridge: DriverBridge;
  workDir: string;
  savePath: string;
}

/** Prepara la pagina con el puente al driver real y una COPIA del save (nunca se toca test_saves/). */
export async function setup(page: Page, save = "Partida_2.rxdata"): Promise<Env> {
  fs.mkdirSync(SHOTS, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "peshex-e2e-"));
  const savePath = path.join(workDir, save);
  fs.copyFileSync(path.join(ROOT, "test_saves", save), savePath);
  const bridge = new DriverBridge(ROOT);
  bridge.dialogPath = savePath;
  await page.exposeFunction("__pwInvoke", (cmd: string, args: Record<string, unknown>) => bridge.handle(cmd, args));
  await page.addInitScript(TAURI_MOCK);
  await page.addInitScript(() => localStorage.clear());
  return { bridge, workDir, savePath };
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
