// Pokémon Z REAL (test_saves/Game.rxdata + test_pbs/*_POKEMON_Z: Data, Graphics, PBS): Essentials v16-18, ids enteros,
// sprites del propio juego. Se omite si falta test_pbs/ (no entra en el paquete ni es necesario para desarrollar).
import { expect, test, type Locator, type Page } from "@playwright/test";
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

/** Ruta relativa de la imagen de la carpeta del juego: el protocolo simulado sirve `/__game/<ruta en base64url>`. */
async function gamePath(img: Locator): Promise<string> {
  const src = (await img.getAttribute("src")) ?? "";
  return Buffer.from(src.split("/").pop() ?? "", "base64url").toString("utf8");
}

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
  // Íconos de categoría: Z trae Graphics/Pictures/category.png (64x84, 3 cuadros) y se usan en vez de los propios.
  const icons = drawer.locator('[role="img"][data-category]');
  await expect(icons.first()).toHaveAttribute("data-source", "game");
  await expect.poll(() => icons.first().locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(64);
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

test("Pokémon Z real: cambiar la naturaleza de un Pokémon sin @natureflag se refleja en el selector (bug 1.1.0)", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await openZ(page)), "falta test_pbs/ (Pokémon Z) o test_saves/Game.rxdata");

  await nav(page, "PC");
  // party/2 no trae @natureflag: su naturaleza sale del ID personal; antes el cambio creaba un @nature que nadie lee.
  await page.locator('[data-cell="party/2"]').click();
  await page.getByTestId("pc-info").getByRole("button", { name: "Editar", exact: true }).click();
  const drawer = page.getByRole("dialog");
  const nature = drawer.getByLabel("Naturaleza", { exact: true });
  await expect(nature).toBeVisible();
  const before = await nature.inputValue();
  await nature.click();
  const target = before.startsWith("Modesta") ? /^Alegre/ : /^Modesta/;
  await page.getByRole("option", { name: target }).click();
  await expect(page.getByRole("button", { name: /^Cambios \d/ })).toBeVisible();
  const after = await nature.inputValue();
  expect(after, "el selector cambia a lo elegido").not.toBe(before);
  expect(after).toMatch(target);
  // Y se queda así tras volver a leer el Pokémon (cerrar y reabrir el editor).
  await page.keyboard.press("Escape");
  await page.locator('[data-cell="party/2"]').click();
  await page.getByTestId("pc-info").getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Naturaleza", { exact: true })).toHaveValue(after);
});

test("Pokémon Z real: las evoluciones de la Pokédex y el campo Especie de «Agregar Pokémon» llevan su sprite", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await openZ(page)), "falta test_pbs/ (Pokémon Z) o test_saves/Game.rxdata");

  await nav(page, "Pokédex");
  await page.getByRole("textbox", { name: "Buscar por nombre o número" }).fill("growlithe");
  await page.getByRole("button", { name: "Ver la ficha de Growlithe" }).click();
  const evo = page.getByTestId("species-sheet").getByTestId("sheet-evolution").getByRole("button", { name: /Arcanine/ }).first();
  await expect(evo).toBeVisible();
  // El icono de la evolución sale de Graphics/Icons/icon059.png (Z nombra los iconos por número de especie).
  await expect(evo.locator("img")).toBeVisible();
  expect(await gamePath(evo.locator("img"))).toMatch(/icon059\.png$/);

  await nav(page, "PC");
  await page.locator('[data-cell^="box/"]:not([data-ref])').first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Agregar Pokémon" }).click();
  const dlg = page.getByRole("dialog", { name: "Agregar Pokémon" });
  const species = dlg.getByRole("combobox", { name: "Especie" });
  await species.fill("pikachu");
  const option = page.getByRole("option", { name: /Pikachu/ }).first();
  await expect(option.locator("img")).toBeVisible();
  expect(await gamePath(option.locator("img"))).toMatch(/icon025\.png$/);
  await option.click();
  const inField = dlg.locator("img").first(); // el valor elegido también muestra su sprite dentro del campo
  await expect(inField).toBeVisible();
  expect(await gamePath(inField)).toMatch(/icon025\.png$/);
});

test("Pokémon Z real: los movimientos muestran el ícono del tipo a la izquierda y la categoría a la derecha", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await openZ(page)), "falta test_pbs/ (Pokémon Z) o test_saves/Game.rxdata");

  await nav(page, "PC");
  await page.locator('[data-cell="party/0"]').click();
  await page.getByTestId("pc-info").getByRole("button", { name: "Editar", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("tab", { name: "Movimientos" }).click();
  const slot = drawer.getByRole("combobox", { name: "Movimiento 1" });
  await expect(slot).toHaveValue(/Envite Ígneo/);
  // Z trae Graphics/Pictures/types.png (64x672): el tipo sale de esa hoja, no de la etiqueta de color.
  const typeIcon = drawer.locator('[role="img"][data-type]').first();
  await expect(typeIcon).toHaveAttribute("data-source", "game");
  await expect.poll(() => typeIcon.locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(64);
  await slot.click();
  const row = page.getByRole("option", { name: /Envite Ígneo/ });
  await expect(row.locator('[data-type]')).toHaveCount(1);
  await expect(row.locator('[data-category]')).toHaveCount(1);
  await expect(row).toContainText(/Pot\. \d+|PP \d+/);
  await shot(page, "145-z-editor-move-selector-es-light");
});

test("Pokémon Z real: la imagen del entrenador (trainer004.png) y las medallas (badges.png) salen del juego", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await openZ(page)), "falta test_pbs/ (Pokémon Z) o test_saves/Game.rxdata");

  for (const view of ["Resumen", "Entrenador"]) {
    await nav(page, view);
    // @trainertype = 4 -> PBS/trainertypes.txt -> POKEMONTRAINER_ChicoNegro; el archivo se llama trainer004 (Graphics/Characters)
    const avatar = page.locator('[data-source="game"][data-via]').first();
    await expect(avatar).toBeVisible();
    expect(await gamePath(avatar.locator("img"))).toMatch(/Graphics\/Characters\/trainer004\.png$/i);
    // Medallas: 8 celdas de badges.png (256x64), 6 conseguidas
    const badges = page.getByRole("img", { name: /^Medalla \d+$/ });
    await expect(badges).toHaveCount(8);
    await expect(page.locator('[role="img"][data-got="true"]')).toHaveCount(6);
    const first = badges.first().locator("img");
    expect(await gamePath(first)).toMatch(/Graphics\/Pictures\/badges\.png$/i);
    await expect.poll(() => first.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(256);
    await shot(page, view === "Resumen" ? "146-z-overview-trainer-es-light" : "147-z-trainer-es-light");
  }
});
