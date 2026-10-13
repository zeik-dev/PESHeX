// Pokémon Z REAL (test_saves/Game.rxdata + test_pbs/*_POKEMON_Z: Data, Graphics, PBS): Essentials v16-18, ids enteros,
// sprites del propio juego. Se omite si falta test_pbs/ (no entra en el paquete ni es necesario para desarrollar).
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { loadedGameImages, openSave, ROOT, serveGameAssets, setup, shot, teardown, type Env } from "./support/harness";
import { realGame } from "./support/realgames";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

const nav = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();

/** Abre Game.rxdata (Z) y vincula la carpeta real. Devuelve false (omitir) si falta test_pbs/. */
async function openZ(page: Page): Promise<boolean> {
  if (!fs.existsSync(path.join(ROOT, "test_saves", "Game.rxdata"))) return false;
  env = await setup(page, "Game.rxdata");
  const root = realGame("z", env.workDir);
  if (!root) return false;
  env.bridge.dialogDir = root;
  await serveGameAssets(page);
  await openSave(page, env, "es", "Kizuga");
  await nav(page, "Ajustes");
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 120_000 });
  return true;
}

test("Pokémon Z real: nombres, sprites e iconos del propio juego, objetos y bola con nombre", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await openZ(page)), "falta test_pbs/ (Pokémon Z) o test_saves/Game.rxdata");

  await expect(page.getByText(/Especies: 1018 · PBS/)).toBeVisible();
  await expect(page.getByText(/imágenes indexadas/)).toBeVisible();
  await shot(page, "140-z-settings-es-light");

  await nav(page, "Equipo");
  // Los ids enteros del save (v16-18) se resuelven con el PBS: nombres reales, nivel/habilidad derivados.
  await expect(page.getByRole("button", { name: /Mofongo/ })).toBeVisible();
  await expect.poll(() => loadedGameImages(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(6);
  await page.getByRole("button", { name: /Mofongo/ }).click();
  const info = page.getByTestId("pc-info");
  await expect(info).toContainText("Arcanine");
  await expect(info).toContainText("Nv. 65");
  await expect(info).toContainText("Intimidación");
  await expect(info).toContainText("Cinta Fuerte");
  await shot(page, "141-z-party-es-light");
});

test("Pokémon Z real: el editor trae stats base, habilidad derivada, bola de $BallTypes y movimientos con tipo", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await openZ(page)), "falta test_pbs/ (Pokémon Z) o test_saves/Game.rxdata");

  await nav(page, "PC");
  await page.locator('[data-cell="party/0"]').click();
  await page.getByTestId("pc-info").getByRole("button", { name: "Editar", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  // Arcanine en Pokémon Z: 90/110/80/100/80/95 (= 555 en total)
  const base = drawer.getByTestId("base-stats");
  await expect(base).toContainText("Stats base en este juego");
  await expect(base).toContainText("555");
  await expect(drawer.getByRole("combobox", { name: "Habilidad" })).toHaveValue(/Intimidaci/);
  await drawer.getByRole("tab", { name: "Movimientos" }).click();
  // Los ids de movimiento del save son números: el selector los muestra con su nombre del PBS.
  await expect(drawer.getByRole("combobox", { name: "Movimiento 1" })).toHaveValue(/Envite Ígneo/);
  await expect(drawer.getByRole("combobox", { name: "Movimiento 4" })).toHaveValue(/Voltio Cruel/);
  await shot(page, "142-z-editor-moves-es-light");
});

test("Pokémon Z real: «Agregar objeto» busca por nombre e id, y las MT se llaman «MT01 · Ventisca»", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await openZ(page)), "falta test_pbs/ (Pokémon Z) o test_saves/Game.rxdata");

  await nav(page, "Mochila");
  const picker = page.getByRole("combobox", { name: "Objeto" }).first();
  await picker.fill("MT01");
  await expect(page.getByRole("option", { name: /MT01 · Ventisca/ }).first()).toBeVisible();
  await picker.fill("Master");
  await expect(page.getByRole("option", { name: /Master Ball/i }).first()).toBeVisible();
  await shot(page, "143-z-bag-picker-es-light");
});

test("Pokémon Z real: la Pokédex abre la ficha de una especie con datos del PBS de v16-18", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await openZ(page)), "falta test_pbs/ (Pokémon Z) o test_saves/Game.rxdata");

  await nav(page, "Pokédex");
  await page.getByRole("textbox", { name: "Buscar por nombre o número" }).fill("growlithe");
  await page.getByRole("button", { name: "Ver la ficha de Growlithe" }).click();
  const sheet = page.getByTestId("species-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("sheet-evolution").getByRole("button", { name: /Arcanine/ }).first()).toBeVisible();
  await expect(sheet.getByTestId("sheet-evolution")).toContainText(/Usar|Piedra|Fuego/);
  await expect(sheet.getByTestId("sheet-types")).toContainText("Débil (×2)");
  await expect(sheet.getByTestId("sheet-moves").getByRole("tab", { name: /MT/ })).toBeVisible();
  await shot(page, "144-z-pokedex-sheet-es-light");
});

test("Pokémon Z real: agregar un Pokémon por nombre en una casilla vacía del PC y deshacerlo", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await openZ(page)), "falta test_pbs/ (Pokémon Z) o test_saves/Game.rxdata");

  await nav(page, "PC");
  const total = page.getByTestId("pc-total");
  const before = Number((await total.innerText()).match(/\d+/)![0]);
  // Primera casilla vacía de la caja visible.
  const empty = page.locator('[data-cell^="box/"]:not([data-ref])').first();
  await empty.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Agregar Pokémon" }).click();
  const dlg = page.getByRole("dialog", { name: "Agregar Pokémon" });
  await dlg.getByRole("combobox", { name: "Especie" }).fill("pikachu");
  await page.getByRole("option", { name: /Pikachu/ }).first().click();
  await dlg.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByText(/Pikachu agregado en/)).toBeVisible();
  await expect(total).toHaveText(`${before + 1} Pokémon en total`);
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(total).toHaveText(`${before} Pokémon en total`);
});
