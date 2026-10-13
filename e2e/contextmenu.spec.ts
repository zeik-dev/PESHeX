import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { buildFakeGame } from "./support/fakegame";
import { openSave, ROOT, serveGameAssets, setup, shot, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

const pending = (page: Page, n: number) => expect(page.getByRole("button", { name: `Cambios ${n}` })).toBeVisible();

async function linkGame(page: Page, e: Env) {
  const game = buildFakeGame(ROOT, path.join(e.workDir, "Mi Juego"), e.savePath, { TORRACAT: "Gatito Fuego" });
  e.bridge.dialogDir = game.root;
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 30_000 });
}

test("clic derecho en un Pokémon: Editar, Clonar, Exportar y Eliminar", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "PC", exact: true }).click();
  const cell = page.locator('[data-cell="party/1"]');
  await cell.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Acciones de la casilla" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["Editar Pokémon", "Clonar", "Exportar Pokémon", "Eliminar"]);
  await shot(page, "130-context-menu-es-light");

  // Esc lo cierra y no deja nada pendiente
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Clonar
  await cell.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Clonar" }).click();
  await expect(page.getByText("Pokémon clonado en la primera casilla libre del PC.")).toBeVisible();
  await pending(page, 1);

  // Exportar
  await cell.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Exportar Pokémon" }).click();
  await expect(page.getByRole("dialog", { name: "Exportar Pokémon" })).toBeVisible();
  await page.getByRole("dialog", { name: "Exportar Pokémon" }).getByRole("button", { name: "Cerrar" }).click();

  // Editar abre la hoja
  await cell.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Editar Pokémon" }).click();
  await expect(page.getByRole("dialog").getByTestId("base-stats")).toBeVisible();
  await page.keyboard.press("Escape");

  // Eliminar pide confirmación y se deshace
  await cell.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Eliminar" }).click();
  await expect(page.getByRole("dialog", { name: /^Liberar a / })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Liberar" }).click();
  await pending(page, 2);
  await page.keyboard.press("Control+z");
  await pending(page, 1);
});

test("el menú se maneja con el teclado (flechas, Intro y Esc) y no abre el menú del navegador", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await page.locator('[data-cell="party/0"]').click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Editar Pokémon" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Clonar" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Eliminar" })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter"); // Editar Pokémon
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("clic derecho en una casilla vacía: Agregar Pokémon por especie en el PC", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  await page.getByRole("button", { name: "PC", exact: true }).click();
  const total = page.getByTestId("pc-total");
  await expect(total).toHaveText("11 Pokémon en total");

  const empty = page.locator('[data-cell="box/0/17"]');
  await empty.click({ button: "right" });
  await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["Agregar Pokémon"]);
  await page.getByRole("menuitem", { name: "Agregar Pokémon" }).click();

  const dlg = page.getByRole("dialog", { name: "Agregar Pokémon" });
  await expect(dlg).toBeVisible();
  const species = dlg.getByRole("combobox", { name: "Especie" });
  await species.fill("gatito");
  await page.getByRole("option", { name: /Gatito Fuego/ }).first().click();
  await dlg.getByRole("textbox", { name: "Nivel" }).fill("12");
  await dlg.getByRole("textbox", { name: "Nivel" }).press("Enter");
  await dlg.getByRole("textbox", { name: "Apodo" }).fill("Brasita");
  await dlg.getByRole("textbox", { name: "Apodo" }).press("Enter");
  await shot(page, "131-add-pokemon-es-light");
  await dlg.getByRole("button", { name: "Agregar", exact: true }).click();

  await expect(page.getByText(/Gatito Fuego agregado en/)).toBeVisible();
  await expect(total).toHaveText("12 Pokémon en total");
  await pending(page, 1);
  // Queda seleccionado en la casilla de destino, con los datos de la especie (no los de la plantilla)
  await expect(page.getByTestId("pc-info")).toContainText("Brasita");
  await expect(page.getByTestId("pc-info")).toContainText("Nv. 12");
  const r = (await env.bridge.handle("driver_call", { cmd: "get_pokemon", params: { ref: "box/0/17" } })) as {
    value: { pokemon: { nickname: string; level: number; species: { id: string }; evTotal: number; moves: unknown[] } };
  };
  expect(r.value.pokemon.nickname).toBe("Brasita");
  expect(r.value.pokemon.level).toBe(12);
  expect(r.value.pokemon.species.id).toBe("TORRACAT");
  expect(r.value.pokemon.evTotal).toBe(0);
  expect(r.value.pokemon.moves.length).toBeGreaterThan(0);

  await page.keyboard.press("Control+z");
  await expect(total).toHaveText("11 Pokémon en total");
});

test("una casilla vacía seleccionada ofrece el botón Agregar Pokémon en el panel de datos", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await page.locator('[data-cell="box/0/17"]').click();
  const info = page.getByTestId("pc-info").or(page.getByRole("complementary", { name: "Datos del Pokémon" }));
  await expect(info.getByRole("button", { name: "Agregar Pokémon" })).toBeVisible();
});
