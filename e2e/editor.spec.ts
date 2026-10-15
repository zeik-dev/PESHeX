import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { buildFakeGame } from "./support/fakegame";
import { openSave, ROOT, serveGameAssets, setMode, setup, shot, teardown, type Env } from "./support/harness";
import { realGame } from "./support/realgames";

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

async function openEditor(page: Page, ref = "party/0") {
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await page.locator(`[data-cell="${ref}"]`).click();
  await page.getByTestId("pc-info").getByRole("button", { name: "Editar", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  return drawer;
}

test("la hoja de edición es ancha, muestra los stats base del juego y la pestaña Legalidad solo existe en HeX", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);

  const drawer = await openEditor(page);
  const box = (await drawer.boundingBox())!;
  expect(box.width, "algo más de la mitad de la pantalla").toBeGreaterThanOrEqual(1280 * 0.55);
  await expect(drawer.getByTestId("base-stats")).toContainText("Stats base en este juego");
  await expect(drawer.getByTestId("base-stats").getByText(/^Total \d+$/)).toBeVisible();
  for (const stat of ["PS", "Ataque", "Defensa", "At. Esp.", "Def. Esp.", "Velocidad"]) {
    await expect(drawer.getByTestId("base-stats").getByText(stat, { exact: true })).toBeVisible();
  }
  await expect(drawer.getByRole("tab", { name: /Legalidad/ })).toHaveCount(0);
  await shot(page, "120-editor-wide-es-light");
  // Información: las cintas del Pokémon (Partida_2 las trae vacías) salen en su fila.
  await drawer.getByRole("tab", { name: "Información" }).click();
  await expect(drawer.getByTestId("pokemon-ribbons")).toHaveText("—");
  await page.keyboard.press("Escape");

  await setMode(page, "hex");
  await openEditor(page);
  await expect(page.getByRole("dialog").getByRole("tab", { name: /Legalidad/ })).toBeVisible();
});

test("la ficha, las acciones rápidas y las pestañas quedan fijas; solo hace scroll el contenido de la pestaña", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  const drawer = await openEditor(page);

  // El preset de EV sugerido ya no está en la cabecera: solo vive en la pestaña IV y EV.
  await expect(drawer.getByTestId("ev-presets")).toHaveCount(0);
  const card = drawer.getByTestId("base-stats");
  const tabs = drawer.getByRole("tab", { name: "IV y EV" });
  const before = { card: (await card.boundingBox())!.y, tabs: (await tabs.boundingBox())!.y };

  await tabs.click();
  await expect(drawer.getByTestId("ev-presets")).toHaveCount(1);
  const scroll = drawer.getByTestId("editor-scroll");
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await scroll.evaluate((el) => el.scrollTop), "el contenido sí hace scroll").toBeGreaterThan(0);
  const after = { card: (await card.boundingBox())!.y, tabs: (await tabs.boundingBox())!.y };
  expect(after.card, "la ficha no se mueve").toBe(before.card);
  expect(after.tabs, "las pestañas no se mueven").toBe(before.tabs);
  await expect(drawer.getByRole("button", { name: "Curar" }).first()).toBeInViewport();
});

test("la ficha alterna entre stats base y actuales; las actuales se desglosan por color con un globo en cada tramo", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  const drawer = await openEditor(page);

  const card = drawer.getByTestId("base-stats");
  await expect(card).toContainText("Stats base en este juego");
  await card.getByRole("radio", { name: "Estadísticas actuales" }).click();
  await expect(card.getByRole("radio", { name: "Estadísticas actuales" })).toHaveAttribute("aria-checked", "true");
  const bars = card.getByRole("meter");
  await expect(bars).toHaveCount(6);
  // Cada stat lleva su total a la derecha y la leyenda nombra los cuatro factores (el color no es lo único que informa).
  for (const f of ["Base y nivel", "IV", "EV", "Naturaleza"]) await expect(card.getByText(f, { exact: true })).toBeVisible();
  const seg = bars.first().locator("> span").first();
  await seg.hover();
  await expect(page.getByRole("tooltip")).toContainText(/Base y nivel: \+\d+/);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  // Los tramos son de colores distintos (base, IV, EV).
  const colors = await bars.first().locator("> span").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(new Set(colors).size).toBeGreaterThanOrEqual(2);
  await shot(page, "124-editor-stats-actuales-es-light");

  // La preferencia se recuerda al volver a la vista base.
  await card.getByRole("radio", { name: "Estadísticas base en este juego" }).click();
  await expect(card).toContainText("Stats base en este juego");
});

test("nivel, felicidad y PS tienen deslizador y campo; un gesto es UNA edición; 0 PS es debilitado", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  const drawer = await openEditor(page);

  // Arrastrar con el ratón: muchos «input» pero una sola edición al soltar.
  const slider = drawer.getByRole("slider", { name: "Nivel (deslizador)" });
  const levelBox = drawer.getByRole("textbox", { name: "Nivel", exact: true });
  const before = await levelBox.inputValue();
  const b = (await slider.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2, { steps: 8 });
  await expect(page.getByRole("button", { name: /^Cambios \d/ })).toHaveCount(0); // sin soltar no hay cambio
  await page.mouse.up();
  await pending(page, 1);
  await expect(levelBox).not.toHaveValue(before);
  expect(Number(await levelBox.inputValue())).toBeGreaterThan(Number(before));

  await drawer.getByRole("slider", { name: "Felicidad (deslizador)" }).focus();
  await page.keyboard.press("End");
  await expect(drawer.getByRole("textbox", { name: "Felicidad", exact: true })).toHaveValue("255");

  const hp = drawer.getByRole("textbox", { name: "PS actuales", exact: true });
  await hp.fill("0");
  await hp.press("Enter");
  await expect(drawer.getByText("Debilitado", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("slider", { name: "PS actuales (deslizador)" })).toHaveAttribute("min", "1");
  await shot(page, "121-editor-sliders-es-light");
});

test("las habilidades y los movimientos se filtran por especie (HaX: interruptor activado por defecto; HeX: forzado)", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  const drawer = await openEditor(page);

  const optionCount = async (name: string) => {
    await drawer.getByRole("combobox", { name }).click();
    const n = await page.getByRole("option").count();
    await page.keyboard.press("Escape");
    return n;
  };

  const abilitySwitch = drawer.getByRole("switch", { name: "Mostrar solo habilidades de la Especie" });
  await expect(abilitySwitch).toHaveAttribute("aria-checked", "true");
  const onlySpecies = await optionCount("Habilidad");
  await abilitySwitch.click();
  await expect(abilitySwitch).toHaveAttribute("aria-checked", "false");
  const all = await optionCount("Habilidad");
  expect(onlySpecies).toBeLessThan(all);
  await abilitySwitch.click();

  await drawer.getByRole("tab", { name: /Movimientos/ }).click();
  const moveSwitch = drawer.getByRole("switch", { name: "Mostrar solo movimientos aprendidos por la especie" });
  await expect(moveSwitch).toHaveAttribute("aria-checked", "true");
  const slot = drawer.getByRole("combobox", { name: /Movimiento 1/ });
  await slot.click();
  const learnable = await page.getByRole("option").count();
  await page.keyboard.press("Escape");
  await moveSwitch.click();
  await slot.click();
  const everything = await page.getByRole("option").count();
  await page.keyboard.press("Escape");
  expect(learnable).toBeLessThan(everything);
  // Cada fila enseña tipo, categoría y potencia del juego
  await expect(drawer.getByText(/Pot\. \d+|Estado|Físico|Especial/).first()).toBeVisible();
  await shot(page, "122-editor-moves-es-light");
  await page.keyboard.press("Escape");

  // HeX: el filtro es obligatorio (no hay interruptor)
  await setMode(page, "hex");
  await openEditor(page);
  await expect(page.getByRole("dialog").getByRole("switch", { name: "Mostrar solo habilidades de la Especie" })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("tab", { name: /Movimientos/ }).click();
  await expect(page.getByRole("dialog").getByRole("switch", { name: "Mostrar solo movimientos aprendidos por la especie" })).toHaveCount(0);
});

test("IV y EV: orden de las secciones, Poder oculto, estadísticas totales y recalcular", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  const drawer = await openEditor(page);
  await drawer.getByRole("tab", { name: "IV y EV" }).click();

  const label = (text: string) => drawer.locator('[class*="sectionLabel"]').getByText(text, { exact: true });
  const y = async (loc: import("@playwright/test").Locator) => (await loc.first().boundingBox())!.y;
  const order = [
    await y(label("IV")),
    await y(drawer.getByTestId("hidden-power")),
    await y(label("Acciones rápidas de IV")),
    await y(label("EV")),
    await y(drawer.getByTestId("ev-presets")),
    await y(label("Estadísticas totales")),
    await y(drawer.getByRole("button", { name: "Recalcular estadísticas" }).last()), // la de arriba es la de «Acciones rápidas»
  ];
  expect(order, "IV → Poder oculto → acciones de IV → EV → presets → totales → recalcular").toEqual([...order].sort((a, b) => a - b));

  await expect(drawer.getByTestId("hidden-power")).toContainText(/potencia \d+/);
  // IV al máximo cambia el Poder oculto (31 en todo = Siniestro) y los totales se calculan con la fórmula del juego
  await drawer.getByRole("button", { name: "IV perfectos (31)" }).click();
  await expect(drawer.getByTestId("hidden-power")).toContainText(/Siniestro|Dark/i);
  await expect(drawer.getByTestId("total-stats")).toContainText("PS");
  await expect(drawer.getByRole("button", { name: "Limpiar EV" })).toBeVisible();
  await expect(drawer.getByRole("slider", { name: "IV PS (deslizador)" })).toHaveValue("31");
  await shot(page, "123-editor-stats-es-light");
});

test("naturaleza por menta (Pokémon Añil): se lee, se cambia y la original no se toca", async ({ page }) => {
  env = await setup(page, "Partida.rxdata");
  await openSave(page, env, "es", "Resumen");
  const drawer = await openEditor(page);
  const mint = drawer.getByLabel("Naturaleza por menta");
  const nature = drawer.getByLabel("Naturaleza", { exact: true });
  await expect(mint).toHaveValue(/Seria|Serious/);
  await expect(nature).toHaveValue(/Modesta|Modest/);
  // El selector enseña a la derecha qué sube (+) y qué baja (−) y el nombre efectivo va en negrita.
  await nature.click();
  const firme = page.getByRole("option", { name: /Firme|Adamant/ });
  await expect(firme).toContainText(/\+Atq/);
  await expect(firme).toContainText(/−AtE/);
  const colorOf = (txt: string) => firme.getByText(txt, { exact: true }).evaluate((el) => getComputedStyle(el).color);
  expect(await colorOf("+Atq"), "lo que sube (rojo) y lo que baja (azul) no comparten color").not.toBe(await colorOf("−AtE"));
  await page.keyboard.press("Escape");
  await mint.click();
  await page.getByRole("option", { name: /Firme|Adamant/ }).click();
  await pending(page, 1);
  await expect(drawer.getByTestId("nature-effective")).toContainText(/Firme|Adamant/);
  await expect(drawer.getByTestId("nature-effective").locator("strong")).toHaveText(/Firme|Adamant/);
  await expect(nature).toHaveValue(/Modesta|Modest/);
  await mint.click();
  await page.getByRole("option", { name: /sin menta|No mint/i }).click();
  await expect(drawer.getByTestId("nature-effective")).toContainText(/Modesta|Modest/);
});

test("con el filtro por especie apagado, los selectores de habilidades y movimientos listan TODAS las opciones del juego", async ({ page }) => {
  test.setTimeout(120_000);
  env = await setup(page); // Partida_2 = Pokémon Añil (v21)
  const root = realGame("anil", env.workDir);
  test.skip(!root, "falta test_pbs/PBS_POKEMON_ANIL");
  env.bridge.dialogDir = root!;
  await openSave(page, env);
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 60_000 });

  const cat = (await env.bridge.handle("driver_call", { cmd: "get_catalog", params: { kinds: ["moves", "abilities"] } })) as {
    value: { catalog: { moves: unknown[]; abilities: unknown[] } };
  };
  const totalMoves = cat.value.catalog.moves.length;
  const totalAbilities = cat.value.catalog.abilities.length;
  expect(totalMoves).toBeGreaterThan(800);
  expect(totalAbilities).toBeGreaterThan(300);

  const drawer = await openEditor(page);
  const count = async (combo: ReturnType<typeof drawer.getByRole>) => {
    await combo.click();
    const n = await page.getByRole("listbox").getByRole("option").count();
    await page.keyboard.press("Escape");
    return n;
  };

  // Habilidades: filtro encendido -> las de la especie; apagado -> todas (sin el tope de 60)
  const ability = drawer.getByRole("combobox", { name: "Habilidad" });
  const abilitySwitch = drawer.getByRole("switch", { name: "Mostrar solo habilidades de la Especie" });
  expect(await count(ability)).toBeLessThan(10);
  await abilitySwitch.click();
  expect(await count(ability)).toBe(totalAbilities);

  // Movimientos: igual
  await drawer.getByRole("tab", { name: /Movimientos/ }).click();
  const slot = drawer.getByRole("combobox", { name: /Movimiento 1/ });
  const moveSwitch = drawer.getByRole("switch", { name: "Mostrar solo movimientos aprendidos por la especie" });
  expect(await count(slot)).toBeLessThan(totalMoves);
  await moveSwitch.click();
  expect(await count(slot)).toBe(totalMoves);

  // Se puede llegar a una opción del final de la lista (teclado y scroll) y elegirla.
  await slot.click();
  await slot.fill("Z");
  expect(await page.getByRole("listbox").getByRole("option").count()).toBeGreaterThan(60);
  await page.keyboard.press("Escape");
});

test("los desplegables de los selectores se abren hacia arriba cuando abajo no caben y nunca se salen de la ventana", async ({ page }) => {
  test.setTimeout(120_000);
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  await page.setViewportSize({ width: 1280, height: 560 }); // baja: el 4.º movimiento queda pegado al borde inferior

  const drawer = await openEditor(page);
  await drawer.getByRole("tab", { name: /Movimientos/ }).click();
  const moveSwitch = drawer.getByRole("switch", { name: "Mostrar solo movimientos aprendidos por la especie" });
  if ((await moveSwitch.getAttribute("aria-checked")) === "true") await moveSwitch.click(); // todos los movimientos: lista larga

  const sides = new Set<string>();
  for (const n of [1, 2, 3, 4]) {
    const input = drawer.getByRole("combobox", { name: new RegExp(`Movimiento ${n}`) });
    await input.scrollIntoViewIfNeeded();
    await input.click();
    const list = page.getByRole("listbox");
    await expect(list.getByRole("option").first()).toBeVisible();
    const box = (await list.boundingBox())!;
    const field = (await input.boundingBox())!;
    // alto del viewport en px CSS (con la escala automática no es el físico: 560 px de ventana son más px CSS)
    const vh = await page.evaluate(() => window.innerHeight);
    expect(box.y, `lista del movimiento ${n} por encima del borde superior`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `lista del movimiento ${n} por debajo del borde inferior`).toBeLessThanOrEqual(vh);
    const side = (await list.getAttribute("data-side")) ?? "";
    sides.add(side);
    // pegada al campo por el lado elegido, sin taparlo
    if (side === "up") expect(box.y + box.height).toBeLessThanOrEqual(field.y + 1);
    else expect(box.y).toBeGreaterThanOrEqual(field.y + field.height - 1);
    // la última opción de la lista se alcanza con el scroll de la propia lista (alto limitado al espacio libre)
    await list.getByRole("option").last().scrollIntoViewIfNeeded();
    await page.keyboard.press("Escape");
  }
  expect([...sides], "al menos un selector tuvo que abrirse hacia arriba en una ventana tan baja").toContain("up");
  await shot(page, "150-combobox-flip-es-light");
});

for (const withSheet of [false, true]) {
  test(`los movimientos muestran su categoría con íconos ${withSheet ? "de la carpeta del juego (category.png)" : "propios (el juego no trae category.png)"}`, async ({ page }) => {
    env = await setup(page);
    await serveGameAssets(page);
    await openSave(page, env);
    const game = buildFakeGame(ROOT, path.join(env.workDir, "Mi Juego"), env.savePath, { TORRACAT: "Gatito Fuego" }, { category: withSheet });
    env.bridge.dialogDir = game.root;
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    await page.getByRole("button", { name: "Elegir carpeta…" }).click();
    await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 30_000 });

    const drawer = await openEditor(page);
    await drawer.getByRole("tab", { name: /Movimientos/ }).click();
    const icons = drawer.locator('[role="img"][data-category]');
    await expect(icons.first()).toBeVisible();
    await expect(icons.first()).toHaveAttribute("data-source", withSheet ? "game" : "own");
    await expect(icons.first()).toHaveAttribute("aria-label", /Físico|Especial|Estado/);
    if (withSheet) {
      // La hoja del juego se carga de verdad (asset protocol) y se recorta el cuadro de la categoría.
      await expect.poll(() => icons.first().locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(64);
    }
    await shot(page, `121-move-category-${withSheet ? "game" : "own"}-es-light`);

    // El selector de movimientos también las muestra en cada opción.
    await drawer.getByRole("combobox", { name: /Movimiento 1/ }).click();
    await expect(page.getByRole("listbox").locator('[role="img"][data-category]').first()).toBeVisible();
    await page.keyboard.press("Escape");
  });
}
