import { expect, test } from "@playwright/test";
import path from "node:path";
import { buildFakeGame } from "./support/fakegame";
import { loadedGameImages, openSave, ROOT, serveGameAssets, setup, shot, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

/** Carpeta de juego sintetica junto a la copia del save. */
function fakeGame(e: Env, renames: Record<string, string> = { TORRACAT: "Gatito Fuego" }) {
  const game = buildFakeGame(ROOT, path.join(e.workDir, "Mi Juego"), e.savePath, renames);
  e.bridge.dialogDir = game.root;
  return game;
}

async function linkFromSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 30_000 });
}

test("vincular la carpeta del juego: nombres reales, sprites y selectores con búsqueda", async ({ page }) => {
  env = await setup(page);
  fakeGame(env);
  await serveGameAssets(page);
  await openSave(page, env);

  await linkFromSettings(page);
  await expect(page.getByText(/Especies: \d+ · Data\/\*\.dat/)).toBeVisible();
  await expect(page.getByText("Legalidad completa")).toBeVisible();
  await expect(page.getByText(/imágenes indexadas/)).toBeVisible();
  await shot(page, "80-game-settings-es-light");

  // Nombres del juego + sprites reales en el equipo.
  await page.getByRole("button", { name: "Equipo", exact: true }).click();
  await expect(page.getByRole("button", { name: /Gatito Fuego/ })).toBeVisible();
  await expect.poll(() => loadedGameImages(page)).toBeGreaterThanOrEqual(6);
  await shot(page, "81-party-sprites-es-light");

  // Selector de especie con busqueda difusa (sin acentos, tolera erratas).
  await page.getByRole("button", { name: /^Trump/ }).click();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const drawer = page.getByRole("dialog");
  const species = drawer.getByRole("combobox", { name: "Especie" });
  await species.click();
  await species.fill("torrcat");
  const option = page.getByRole("option", { name: /Gatito Fuego/ });
  await expect(option).toBeVisible();
  await shot(page, "82-species-combobox-es-light");
  await option.click();
  // Con el juego vinculado, HeX sabe que sus movimientos/habilidades no son de esa especie: lo rechaza.
  const rejected = page.getByRole("dialog", { name: "Cambio no permitido en HeX" });
  await expect(rejected).toBeVisible();
  await expect(rejected.getByText(/no lo puede aprender esta especie/).first()).toBeVisible();
  await shot(page, "83-species-hex-rejected-es-light");
  await rejected.getByRole("button", { name: "Cambiar a HaX" }).click();
  await species.click();
  await species.fill("torrcat");
  await page.getByRole("option", { name: /Gatito Fuego/ }).click();
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();
});

test("si el asset protocol falla, los sprites cargan por bytes (plan B)", async ({ page }) => {
  env = await setup(page);
  fakeGame(env);
  await serveGameAssets(page, { value: "forbidden" });
  await openSave(page, env);
  await linkFromSettings(page);
  await page.getByRole("button", { name: "Equipo", exact: true }).click();
  await expect.poll(() => loadedGameImages(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(6);
  const blobs = await page.evaluate(() => [...document.images].filter((i) => i.src.startsWith("blob:") && i.naturalWidth > 0).length);
  expect(blobs).toBeGreaterThanOrEqual(6);
});

test("la carpeta del juego se recuerda para ese save", async ({ page }) => {
  env = await setup(page);
  fakeGame(env);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkFromSettings(page);
  await page.getByRole("button", { name: "Cerrar archivo" }).click();
  await page.getByRole("button", { name: "Abrir partida…" }).click();
  await page.getByRole("button", { name: "Equipo", exact: true }).click();
  await expect(page.getByRole("button", { name: /Gatito Fuego/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await expect(page.getByText(/Recordada de la última vez/)).toBeVisible();
});

test("una carpeta que no es de un juego se rechaza con un aviso claro", async ({ page }) => {
  env = await setup(page);
  env.bridge.dialogDir = env.workDir; // solo contiene el save
  await openSave(page, env);
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText(/no parece un juego de Pokémon Essentials/)).toBeVisible();
});

test("desvincular vuelve a los nombres embebidos y marcadores", async ({ page }) => {
  env = await setup(page);
  fakeGame(env);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkFromSettings(page);
  await page.getByRole("button", { name: "Desvincular" }).click();
  await expect(page.getByRole("button", { name: "Elegir carpeta…" })).toBeVisible();
  await page.getByRole("button", { name: "Equipo", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Grillita/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Gatito Fuego/ })).toHaveCount(0);
});
