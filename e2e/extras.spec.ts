import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { suggestEvPreset } from "../src/features/pokemon/quick";
import { buildFakeGame } from "./support/fakegame";
import { openSave, ROOT, serveGameAssets, setMode, setup, shot, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

async function linkGame(page: Page, e: Env) {
  const game = buildFakeGame(ROOT, path.join(e.workDir, "Mi Juego"), e.savePath, { TORRACAT: "Gatito Fuego" });
  e.bridge.dialogDir = game.root;
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 30_000 });
  return game;
}

const nav = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
const pending = (page: Page, n: number) => expect(page.getByRole("button", { name: `Cambios ${n}` })).toBeVisible();
const noPending = (page: Page) => expect(page.getByRole("button", { name: /^Cambios \d/ })).toHaveCount(0);

test("Pokédex: marcar una especie como capturada y deshacerlo con Ctrl+Z", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await nav(page, "Pokédex");
  await expect(page.getByRole("heading", { name: "Pokédex" })).toBeVisible();
  await expect(page.getByText(/\d+ vistos · \d+ capturados/)).toBeVisible();

  // Una especie vista y no capturada: se marca capturada
  await page.getByLabel("Filtro").selectOption("seenOnly");
  const first = page.getByRole("list", { name: "Pokédex" }).getByRole("listitem").first();
  await expect(first).toBeVisible();
  const owned = first.getByRole("switch").nth(1);
  await expect(owned).toHaveAttribute("aria-checked", "false");
  await owned.click();
  await pending(page, 1);
  await page.getByLabel("Filtro").selectOption("all");
  await shot(page, "110-pokedex-es-light");

  await page.keyboard.press("Control+z");
  await noPending(page);
});

test("Pokédex: buscar y marcar vistas todas las que coinciden", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await nav(page, "Pokédex");
  const search = page.getByLabel("Buscar por nombre o número");
  await search.fill("char");
  await page.getByLabel("Filtro").selectOption("seen");
  await expect(page.getByRole("list", { name: "Pokédex" }).getByText("Charmander")).toBeVisible();
  await page.getByRole("button", { name: "Borrar registro" }).click();
  await pending(page, 1);
  await expect(page.getByText("Ninguna especie coincide.")).toBeVisible();
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(page.getByRole("list", { name: "Pokédex" }).getByText("Charmander")).toBeVisible();
});

test("Mundo: interruptores y variables con los nombres de la carpeta del juego", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  await nav(page, "Mundo");
  await page.getByLabel("Buscar por número, nombre o valor").fill("medalla");
  const row = page.getByRole("row", { name: /Medalla 1/ });
  await expect(row).toBeVisible();
  await row.getByRole("switch").click();
  await pending(page, 1);

  await page.getByRole("tab", { name: "Variables" }).click();
  await page.getByLabel("Buscar por número, nombre o valor").fill("pasos");
  const v = page.getByRole("row", { name: /Pasos/ });
  await v.getByLabel("Pasos").fill("4242");
  await v.getByLabel("Pasos").press("Enter");
  await pending(page, 2);
  await shot(page, "111-world-es-light");

  await page.getByRole("tab", { name: "Estadísticas" }).click();
  await expect(page.getByText(/Tiempo de juego/)).toBeVisible();
});

test("Copias: comparar con la copia, restaurar y volver al estado anterior", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await nav(page, "Entrenador");
  const money = page.getByLabel("Dinero");
  await money.fill("12345");
  await money.press("Enter");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Partida guardada.")).toBeVisible();

  await nav(page, "Copias");
  await expect(page.getByTitle(/Partida_2\.rxdata\.\d{8}-\d{6}\.bak/)).toBeVisible();
  await page.getByRole("button", { name: "Comparar", exact: true }).click();
  const diff = page.getByTestId("diff-view");
  await expect(diff).toBeVisible();
  await expect(diff.getByRole("row", { name: /Dinero/ })).toContainText("12345");
  await expect(diff.getByRole("row", { name: /Dinero/ })).toContainText("26350");
  await shot(page, "112-backups-diff-es-light");

  await page.getByRole("button", { name: "Restaurar", exact: true }).click();
  await page.getByRole("dialog", { name: "¿Restaurar esta copia?" }).getByRole("button", { name: "Restaurar" }).click();
  await expect(page.getByText("Copia restaurada.")).toBeVisible();
  await nav(page, "Entrenador");
  await expect(page.getByLabel("Dinero")).toHaveValue(/26[.,\s]?350/);
  // la restauracion dejo una copia del estado anterior
  await nav(page, "Copias");
  await expect(page.getByText("Antes de restaurar")).toBeVisible();
});

test("Copias: con cambios pendientes se puede comparar pero no restaurar", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await nav(page, "Entrenador");
  await page.getByLabel("Dinero").fill("1");
  await page.getByLabel("Dinero").press("Enter");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Partida guardada.")).toBeVisible();
  await page.getByLabel("Dinero").fill("2");
  await page.getByLabel("Dinero").press("Enter");
  await nav(page, "Copias");
  await expect(page.getByText("Hay cambios sin guardar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Restaurar", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Comparar", exact: true }).click();
  await expect(page.getByTestId("diff-view")).toBeVisible();
});

test("Ctrl+K: ir a una vista, buscar un Pokémon y abrirlo", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Buscar y comandos" });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();

  await input.fill("mochila");
  await expect(dialog.getByRole("option", { name: /Ir a Mochila/ })).toBeVisible();
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mochila", exact: true })).toBeVisible();

  await page.keyboard.press("Control+k");
  await dialog.getByRole("combobox").fill("grillita");
  const hit = dialog.getByRole("option", { name: /Grillita/ });
  await expect(hit).toBeVisible();
  await shot(page, "113-palette-es-light");
  await hit.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("pc-info")).toContainText("Grillita");
});

test("atajos: Ctrl+S guarda, Ctrl+Z deshace y Ctrl+Y rehace", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await nav(page, "Entrenador");
  const money = page.getByLabel("Dinero");
  await money.fill("777");
  await money.press("Enter");
  await pending(page, 1);

  // dentro del campo, Ctrl+Z es del texto; fuera, de la partida
  await page.getByRole("heading", { name: "Entrenador", exact: true }).click();
  await page.keyboard.press("Control+z");
  await noPending(page);
  await page.keyboard.press("Control+y");
  await pending(page, 1);
  await page.keyboard.press("Control+Shift+z");
  await pending(page, 1);

  await page.keyboard.press("Control+s");
  await expect(page.getByText("Partida guardada.")).toBeVisible();
  await noPending(page);
});

test("el encabezado tiene deshacer y rehacer", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  const undo = page.getByRole("button", { name: "Deshacer", exact: true });
  const redo = page.getByRole("button", { name: "Rehacer", exact: true });
  await expect(undo).toBeDisabled();
  await nav(page, "Entrenador");
  await page.getByLabel("Dinero").fill("5");
  await page.getByLabel("Dinero").press("Enter");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(redo).toBeEnabled();
  await redo.click();
  await pending(page, 1);
});

test("acciones rápidas: curar, IV al máximo, clonar y exportar un Pokémon", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await page.locator('[data-cell="party/1"]').click();
  const info = page.getByTestId("pc-info");
  await expect(info).toContainText("Grillita");
  await shot(page, "115-pc-quick-actions-es-light");

  await info.getByRole("button", { name: "IV al máximo" }).click();
  await pending(page, 1);
  await info.getByRole("button", { name: "Curar", exact: true }).click();

  await info.getByRole("button", { name: "Clonar" }).click();
  await expect(page.getByText("Pokémon clonado en la primera casilla libre del PC.")).toBeVisible();

  await info.getByRole("button", { name: "Exportar…" }).click();
  const dlg = page.getByRole("dialog", { name: "Exportar Pokémon" });
  const text = dlg.getByLabel("Texto exportado");
  await expect(text).toHaveValue(/Grillita \(TORRACAT\)|Grillita \(Torracat\)/);
  await expect(text).toHaveValue(/Level: 23/);
  await dlg.getByRole("tab", { name: "JSON" }).click();
  await expect(text).toHaveValue(/"schema": "peshex.pokemon\/1"/);
  await dlg.getByRole("button", { name: "Cerrar" }).click();

  // todo se deshace de una vez, hasta los bytes originales
  await page.getByRole("button", { name: /^Cambios \d/ }).click();
  await page.getByRole("button", { name: "Deshacer todo" }).click();
  await noPending(page);
});

test("importar un Pokémon desde texto Showdown (HaX) y verlo en el PC", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Importar Pokémon" });
  await dlg.getByLabel("Texto a importar").fill("Chispa (Gatito Fuego)\nLevel: 31\nAdamant Nature\nEVs: 252 Atk\n- Tackle\n- Inventado Raro");
  await expect(dlg.getByText("Movimiento desconocido: «Inventado Raro» (se omite).")).toBeVisible();
  await shot(page, "114-import-es-light");
  await dlg.getByRole("button", { name: "Importar 1 Pokémon" }).click();
  await expect(page.getByText("1 Pokémon importado.")).toBeVisible();
  await pending(page, 1);

  // el recién llegado está en el PC: la búsqueda global lo encuentra
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Buscar y comandos" }).getByRole("combobox").fill("chispa");
  await expect(page.getByRole("option", { name: /Chispa/ })).toBeVisible();
});

test("una importación inválida no habilita el botón", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Importar Pokémon" });
  await dlg.getByLabel("Texto a importar").fill("{ no es json");
  await expect(dlg.getByText("El JSON no es válido.")).toBeVisible();
  await expect(dlg.getByRole("button", { name: /^Importar \d/ })).toBeDisabled();
  expect(fs.existsSync(env.savePath)).toBe(true);
});

test("iconos sin resolver: aceptar una sugerencia por parecido y asignar otro a mano", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  const game = buildFakeGame(ROOT, path.join(env.workDir, "Mi Juego"), env.savePath, { TORRACAT: "Gatito Fuego" }, {
    iconAliases: { TORRACAT: "misc_icon_07", GUMSHOOS: "misc_icon_08" },
    fronts: true,
  });
  env.bridge.dialogDir = game.root;
  await nav(page, "Ajustes");
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 30_000 });

  const card = page.locator("section", { has: page.getByRole("heading", { name: "Iconos sin resolver" }) });
  await expect(card).toBeVisible();
  await expect(card.getByText("2 archivos sin asignar")).toBeVisible();
  await card.getByLabel("Buscar especie").fill("gatito");
  await expect(card.getByRole("list").getByRole("listitem")).toHaveCount(1);

  // la sugerencia por parecido llega y hay que aceptarla: nada se asigna solo
  await card.getByRole("button", { name: "Sugerir por parecido" }).click();
  const accept = card.getByRole("button", { name: "Aceptar" });
  await expect(accept).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText("misc_icon_07.png")).toBeVisible();
  await shot(page, "116-assets-suggestion-es-light");
  await accept.click();
  await expect(card.getByText("1 asignación manual")).toBeVisible();
  await expect(card.getByText("1 archivo sin asignar")).toBeVisible();

  // asignar el otro a mano con el selector
  await card.getByLabel("Buscar especie").fill("gumshoos");
  await card.getByRole("combobox", { name: /Elegir icono/ }).click();
  await page.getByRole("option", { name: /misc_icon_08/ }).click();
  await expect(card.getByText("2 asignaciones manuales")).toBeVisible();
  await expect(card.getByText("0 archivos sin asignar")).toBeVisible();

  // quitar una asignación la devuelve a la lista
  await card.getByRole("button", { name: "Quitar asignación" }).first().click();
  await expect(card.getByText("1 asignación manual")).toBeVisible();
});

const KEY_LIKE =
  /\b(nav|header|common|pokemon|party|boxes|bag|trainer|overview|settings|game|legality|mode|quick|transfer|palette|shortcuts|pokedex|world|backups|diff|assets|changes|errors|save|profile|pc)\.[A-Za-z_]+(\.[A-Za-z_]+)*\b/;

for (const lang of ["es", "en"] as const) {
  test(`ninguna vista deja claves de traducción sin resolver (${lang})`, async ({ page }) => {
    env = await setup(page);
    await serveGameAssets(page);
    await openSave(page, env, lang, lang === "es" ? "Furikita" : "Furikita");
    const game = buildFakeGame(ROOT, path.join(env.workDir, "Mi Juego"), env.savePath, { TORRACAT: "Gatito Fuego" }, {
      iconAliases: { TORRACAT: "misc_icon_07" },
      fronts: true,
    });
    env.bridge.dialogDir = game.root;
    const navBar = page.getByRole("navigation", { name: "Principal" });
    await navBar.getByRole("button").last().click(); // Ajustes / Settings
    await page.getByRole("button", { name: lang === "es" ? "Elegir carpeta…" : "Choose folder…" }).click();
    await expect(page.getByText(lang === "es" ? "Datos completos" : "Complete data")).toBeVisible({ timeout: 30_000 });

    await setMode(page, "hex", lang); // con HeX el Resumen muestra la tarjeta de legalidad (plegable)
    const count = await navBar.getByRole("button").count();
    for (let i = 0; i < count; i++) {
      await navBar.getByRole("button").nth(i).click();
      await page.waitForTimeout(350);
      const text = await page.evaluate(() => document.body.innerText);
      expect(text.match(KEY_LIKE)?.[0] ?? null, `vista ${i}`).toBeNull();
    }

    // diálogos y paleta
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").getByRole("combobox").fill("a");
    await page.waitForTimeout(400);
    expect((await page.evaluate(() => document.body.innerText)).match(KEY_LIKE)?.[0] ?? null, "paleta").toBeNull();
    await page.keyboard.press("Escape");

    await navBar.getByRole("button").nth(3).click(); // PC
    await page.getByRole("button", { name: lang === "es" ? "Importar" : "Import", exact: true }).click();
    await page.getByRole("dialog").getByRole("textbox").first().fill("Gatito Fuego\n- Tackle\n- Zzz");
    await page.waitForTimeout(300);
    expect((await page.evaluate(() => document.body.innerText)).match(KEY_LIKE)?.[0] ?? null, "importar").toBeNull();
  });
}

test("el preset de EV sugerido sale de los stats más altos de cada Pokémon y se puede aplicar", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "PC", exact: true }).click();
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const r = (await env.bridge.handle("driver_call", { cmd: "get_pokemon", params: { ref: `party/${i}` } })) as {
      value: { pokemon: { stats: { cached: Record<string, number> } } };
    };
    const expected = suggestEvPreset(r.value.pokemon.stats.cached)?.preset;
    expect(expected).toBeTruthy();
    seen.add(expected!);
    await page.locator(`[data-cell="party/${i}"]`).click();
    const advice = page.getByTestId("pc-info").getByTestId("ev-presets");
    await expect(advice.locator(`[data-preset="${expected}"]`)).toBeVisible();
    await expect(advice.getByText(/Por sus stats más altos: .+ y .+ \(stats guardados en la partida\)/)).toBeVisible();
  }
  // Aplicar el sugerido deja los EV del preset (una sola acción que se deshace)
  await page.locator('[data-cell="party/1"]').click();
  const info = page.getByTestId("pc-info");
  await info.getByTestId("ev-presets").getByRole("button", { name: /^Preset de EV sugerido/ }).click();
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();
  await shot(page, "117-ev-preset-es-light");
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: /^Cambios \d/ })).toHaveCount(0);

  // El desplegable ofrece los presets nuevos
  const select = info.getByLabel("Otros presets de EV");
  for (const label of ["Bulky Physical (PS + Ataque)", "Bulky Special (PS + At. Esp.)", "Tank Defense (PS + Defensa)", "Tank Sp. Defense (PS + Def. Esp.)"]) {
    await expect(select.locator("option", { hasText: label })).toHaveCount(1);
  }
  await select.selectOption({ label: "Tank Sp. Defense (PS + Def. Esp.)" });
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();
  await info.getByRole("button", { name: "Editar", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("tab", { name: "IV y EV" }).click();
  await expect(drawer.getByRole("textbox", { name: "EV PS" })).toHaveValue("252");
  await expect(drawer.getByRole("textbox", { name: "EV Def. Esp." })).toHaveValue("252");
  await expect(drawer.getByRole("textbox", { name: "EV Defensa" })).toHaveValue("4");
  await expect(drawer.getByTestId("ev-presets")).toBeVisible(); // también en la pestaña IV y EV
});

test("zoom de la app en Ajustes: 100 % por defecto, sube, baja, se restablece y se recuerda", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await nav(page, "Ajustes");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Zoom de la aplicación" }) });
  const value = card.getByTestId("zoom-value");
  await expect(value).toHaveText("100 %");
  await expect(card.getByRole("button", { name: /^Restablecer/ })).toBeDisabled();

  await card.getByRole("button", { name: "Aumentar el zoom" }).click();
  await expect(value).toHaveText("110 %");
  await expect.poll(() => env!.bridge.zoomCalls.at(-1)).toBe(1.1);
  await card.getByRole("button", { name: "Aumentar el zoom" }).click();
  await expect(value).toHaveText("120 %");
  await expect.poll(() => env!.bridge.zoomCalls.at(-1)).toBe(1.2);

  const slider = card.getByRole("slider", { name: "Zoom de la aplicación" });
  await slider.fill("150");
  await expect(value).toHaveText("150 %");
  await expect(slider).toHaveAttribute("aria-valuetext", "150 %");
  await expect.poll(() => env!.bridge.zoomCalls.at(-1)).toBe(1.5);
  await shot(page, "118-zoom-es-light");

  await card.getByRole("button", { name: "Reducir el zoom" }).click();
  await expect(value).toHaveText("140 %");
  await slider.fill("200");
  await expect(card.getByRole("button", { name: "Aumentar el zoom" })).toBeDisabled();
  await slider.fill("50");
  await expect(card.getByRole("button", { name: "Reducir el zoom" })).toBeDisabled();
  await expect.poll(() => env!.bridge.zoomCalls.at(-1)).toBe(0.5);

  await card.getByRole("button", { name: "Restablecer (100 %)" }).click();
  await expect(value).toHaveText("100 %");
  await expect.poll(() => env!.bridge.zoomCalls.at(-1)).toBe(1);

  // se recuerda al cerrar y volver a abrir el archivo
  await card.getByRole("button", { name: "Aumentar el zoom" }).click();
  await page.getByRole("button", { name: "Cerrar archivo" }).click();
  await page.getByRole("button", { name: "Abrir partida…" }).click();
  await expect(page.getByText("Furikita").first()).toBeVisible();
  await nav(page, "Ajustes");
  await expect(page.getByTestId("zoom-value")).toHaveText("110 %");
});
