import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openSave, ROOT, serveGameAssets, setup, shot, teardown, type Env } from "./support/harness";
import { realGame } from "./support/realgames";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

/** Abre Partida_2 (Pokémon Añil, v21) y vincula el PBS real de Añil. Devuelve false si falta test_pbs/. */
async function openWithAnil(page: Page): Promise<boolean> {
  env = await setup(page);
  const root = realGame("anil", env.workDir);
  if (!root) return false;
  env.bridge.dialogDir = root;
  await openSave(page, env);
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Pokédex", exact: true }).click();
  return true;
}

test("Pokédex: la ficha trae stats base, tipos, evoluciones, movimientos, zonas y numeración regional del PBS", async ({ page }) => {
  test.skip(!(await openWithAnil(page)), "falta test_pbs/PBS_POKEMON_ANIL");

  // Sin título de página y con los recuentos en la barra de filtros.
  await expect(page.getByRole("heading", { level: 1, name: "Pokédex" })).toBeAttached();
  await expect(page.getByText(/\d+ vistos · \d+ capturados · \d+ en total/)).toBeVisible();

  await page.getByRole("textbox", { name: "Buscar por nombre o número" }).fill("pidgey");
  await page.getByRole("button", { name: "Ver la ficha de Pidgey" }).click();
  const sheet = page.getByTestId("species-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Pidgey").first()).toBeVisible();

  // Stats base + total, efectividad de tipos y evolución.
  const stats = sheet.getByTestId("sheet-stats");
  await expect(stats.getByText("PS", { exact: true })).toBeVisible();
  await expect(stats.getByText("Total")).toBeVisible();
  await expect(sheet.getByTestId("sheet-types")).toContainText("Débil (×2)");
  await expect(sheet.getByTestId("sheet-evolution").getByRole("button", { name: /Pidgeotto/ })).toBeVisible();

  // Dónde encontrarlo (encounters.txt) y numeración regional (regional_dexes.txt).
  await expect(sheet.getByTestId("sheet-encounters")).toContainText("Pueblo Paleta");
  await expect(sheet.getByTestId("sheet-encounters")).toContainText(/Nv\. 2–4/);
  await expect(sheet.getByTestId("sheet-regional")).toContainText("Pokédex regional 1");
  expect(await sheet.innerText(), "ninguna clave de traducción sin resolver").not.toMatch(/\bpokedex\.(sheet|evo|enc|growth|color|habitat|eggGroup)\b/);
  await shot(page, "100-pokedex-sheet-es-light");
  await sheet.getByTestId("sheet-evolution").scrollIntoViewIfNeeded();
  await shot(page, "101-pokedex-sheet-evolution-es-light");
  await sheet.getByTestId("sheet-regional").scrollIntoViewIfNeeded();
  await shot(page, "102-pokedex-sheet-encounters-es-light");

  // Movimientos: pestañas con contador y filtro.
  const moves = sheet.getByTestId("sheet-moves");
  await moves.getByRole("tab", { name: /Nivel/ }).click();
  await expect(moves.getByText("Placaje").first()).toBeVisible();
  await moves.getByRole("textbox", { name: "Filtrar movimientos" }).fill("zzzz");
  await expect(moves.getByText("No hay movimientos en esta lista.")).toBeVisible();

  // Navegar por la cadena evolutiva y cerrar.
  await sheet.getByTestId("sheet-evolution").getByRole("button", { name: /Pidgeotto/ }).click();
  await expect(sheet.getByText("Pidgeotto").first()).toBeVisible();
  await expect(sheet.getByTestId("sheet-evolution").getByRole("button", { name: /Pidgey/ })).toBeVisible();
  await sheet.getByRole("button", { name: "Cerrar ficha" }).click();
  await expect(page.getByTestId("species-sheet")).toHaveCount(0);
});

test("Pokédex: las formas (Mega) de Añil se eligen en la ficha y llevan sus propios stats", async ({ page }) => {
  test.skip(!(await openWithAnil(page)), "falta test_pbs/PBS_POKEMON_ANIL");
  await page.getByRole("textbox", { name: "Buscar por nombre o número" }).fill("venusaur");
  await page.getByRole("button", { name: "Ver la ficha de Venusaur" }).click();
  const sheet = page.getByTestId("species-sheet");
  const forms = sheet.getByRole("group", { name: "Formas" });
  await expect(forms).toBeVisible();
  await forms.getByRole("button", { name: /Mega Venusaur X/ }).click();
  await expect(sheet.getByTestId("sheet-evolution")).toContainText("Megapiedra");
  await expect(sheet.getByTestId("sheet-stats")).toContainText("100");
});

test("sin carpeta del juego la lista no abre fichas y el aviso lo explica", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "Pokédex", exact: true }).click();
  await expect(page.getByText("Solo se ven las especies que la partida menciona")).toBeVisible();
  await expect(page.getByTestId("species-sheet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Ver la ficha de/ })).toHaveCount(0);
});

/** Abre el save de `game` (Z o Añil) con su carpeta real vinculada y entra en la Pokédex. false = omitir (falta test_pbs/). */
async function openDexWith(page: Page, game: "z" | "anil", before?: (e: Env) => void): Promise<boolean> {
  const save = game === "z" ? "Game.rxdata" : "Partida_2.rxdata";
  if (!fs.existsSync(path.join(ROOT, "test_saves", save))) return false;
  env = await setup(page, save);
  const root = realGame(game, env.workDir);
  if (!root) return false;
  env.bridge.dialogDir = root;
  before?.(env);
  await serveGameAssets(page);
  await openSave(page, env, "es", game === "z" ? "Kizuga" : "Furikita");
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Pokédex", exact: true }).click();
  return true;
}

const dexRows = (page: Page) => page.locator('ul[aria-label="Pokédex"] button[aria-label^="Ver la ficha de"]');

for (const game of ["z", "anil"] as const) {
  test(`Pokédex (${game === "z" ? "Pokémon Z" : "Pokémon Añil"}): elegir una especie tras otra en la lista siempre abre su ficha`, async ({ page }) => {
    test.setTimeout(180_000);
    test.skip(!(await openDexWith(page, game)), "falta test_pbs/ o el save de prueba");
    const rows = dexRows(page);
    await expect(rows.first()).toBeVisible();
    for (let i = 0; i < 12; i++) {
      const name = (await rows.nth(i).getAttribute("aria-label"))!.replace("Ver la ficha de ", "");
      await rows.nth(i).click();
      const sheet = page.getByTestId("species-sheet");
      await expect(sheet.getByTestId("sheet-stats"), `ficha ${i + 1} (${name})`).toBeVisible({ timeout: 3_000 });
      await expect(sheet).toContainText(name);
      await expect(page.getByText("Cargando la ficha…")).toHaveCount(0);
    }
  });
}

test("Pokédex: con latencia y clics rápidos entre especies, la última elegida acaba cargando", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await openDexWith(page, "z", (e) => { e.bridge.callDelayMs = 600; })), "falta test_pbs/ o el save de prueba");
  const rows = dexRows(page);
  await expect(rows.first()).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await rows.nth(i).click();
    await page.waitForTimeout(120);
  }
  const last = (await rows.nth(5).getAttribute("aria-label"))!.replace("Ver la ficha de ", "");
  const sheet = page.getByTestId("species-sheet");
  await expect(sheet.getByTestId("sheet-stats")).toBeVisible({ timeout: 15_000 });
  await expect(sheet).toContainText(last);
});
